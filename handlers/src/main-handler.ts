import {
  OSISClient,
  CreatePipelineCommand,
  GetPipelineCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-osis';
import {
  SQSClient,
  CreateQueueCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import * as logging from '@nr1e/logging';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {getOpenSearchClient} from './open-search-helper';

// Constants for configuration
const REGION = process.env.AWS_REGION!;
const OPEN_SEARCH_MASTER_ROLE_ARN = process.env.OPEN_SEARCH_MASTER_ROLE_ARN!;
if (!OPEN_SEARCH_MASTER_ROLE_ARN) {
  throw new Error('Missing env var OPEN_SEARCH_MASTER_ROLE_ARN');
}
const OPEN_SEARCH_ENDPOINT = process.env.OPEN_SEARCH_ENDPOINT!;
if (!OPEN_SEARCH_ENDPOINT) {
  throw new Error('Missing env var OPEN_SEARCH_ENDPOINT');
}

const log = logging.getLogger('main-handler');
const sqsClient = new SQSClient({});

// Extracts bucket name and object key from the event
function extractBucketDetails(event: any) {
  return {
    bucketName: event.detail.requestParameters.bucketName,
    objectKey: event.detail.requestParameters.key,
  };
}

// Extracts index name from the object key
function extractIndexName(objectKey: string) {
  return objectKey.split('/')[1]; // Assumes index name is part of the object key
}

// Ensures that the pipeline exists or creates a new one
async function ensurePipelineExists(
  pipelineName: string,
  indexName: string,
  queueUrl: string,
  log: any
) {
  const osisClient = new OSISClient({region: REGION});

  try {
    await osisClient.send(new GetPipelineCommand({PipelineName: pipelineName}));
    log
      .info()
      .str('pipelineName', pipelineName)
      .msg('Pipeline already exists.');
    //await createOrUpdateISMPolicy(log); //TODO Uncomment and change the call location
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      log
        .info()
        .str('pipelineName', pipelineName)
        .msg('Pipeline not found, creating new pipeline...');
      await createPipeline(pipelineName, indexName, queueUrl, log);
    } else {
      log.error().err(error).msg('Error while checking pipeline existence');
      throw error;
    }
  }
}

// Creates a new pipeline with given parameters
async function createPipeline(
  pipelineName: string,
  indexName: string,
  queueUrl: string,
  log: any
) {
  const logGroupName = `/aws/vendedlogs/${pipelineName}`;
  await ensureLogGroupExists(logGroupName, pipelineName, log);
  const opensearchRoleArn = process.env.OSIS_ROLE_ARN || '';
  const pipelineConfigurationBody = generateLogPipelineYaml(
    `https://${OPEN_SEARCH_ENDPOINT}`,
    indexName,
    REGION,
    opensearchRoleArn,
    queueUrl,
    JSON.stringify({
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: {
          time: {
            type: 'date',
            format: 'epoch_millis',
          },
        },
      },
    })
  );

  const input = {
    PipelineName: pipelineName,
    MinUnits: 1,
    MaxUnits: 5,
    PipelineConfigurationBody: pipelineConfigurationBody,
    LogPublishingOptions: {
      IsLoggingEnabled: true,
      CloudWatchLogDestination: {
        LogGroup: logGroupName,
      },
    },
    BufferOptions: {
      PersistentBufferEnabled: false,
    },
  };
  const osisClient = new OSISClient({region: REGION});

  try {
    await osisClient.send(new CreatePipelineCommand(input));
    log
      .info()
      .str('pipelineName', pipelineName)
      .msg('Pipeline created successfully');
  } catch (error) {
    log.error().err(error).msg('Error creating pipeline');
    throw error;
  }
}

// Creates an SQS queue if it doesn't exist
async function createQueueIfNeeded(
  indexName: string,
  log: any
): Promise<string> {
  const queueName = `overwatch-${indexName}-queue`;
  try {
    const {QueueUrl} = await sqsClient.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: {
          DelaySeconds: '0',
          MessageRetentionPeriod: '345600',
        },
        tags: {
          'automation:url': 'https://github.com/truemark/overwatch',
          'automation:component-id': 'overwatch',
        },
      })
    );
    log.info().str('queueName', queueName).msg('SQS Queue created');
    return QueueUrl || '';
  } catch (error) {
    log.error().err(error).msg('Failed to create SQS Queue');
    throw error;
  }
}

// Sends a message to the specified SQS queue
async function sendMessageToQueue(
  queueUrl: string,
  messageBody: any,
  log: any
) {
  try {
    const {MessageId} = await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(messageBody),
      })
    );
    log.info().str('messageId', MessageId).msg('Message sent to SQS Queue');
  } catch (error) {
    log.error().err(error).msg('Failed to send message to SQS Queue');
    throw error;
  }
}

async function ensureLogGroupExists(
  logGroupName: string,
  pipelineName: string,
  log: any
) {
  const cwlClient = new CloudWatchLogsClient({region: REGION});

  try {
    // Try to create the log group (idempotent if it already exists)
    await cwlClient.send(new CreateLogGroupCommand({logGroupName}));
    // await createNewPolicyForLogGroup(logGroupName, pipelineName, log);

    log.info().str('logGroupName', logGroupName).msg('Log group ensured.');
  } catch (error) {
    if ((error as Error).name === 'ResourceAlreadyExistsException') {
      //Always ensure policy is created
      // await createNewPolicyForLogGroup(logGroupName, pipelineName, log);

      log
        .info()
        .str('logGroupName', logGroupName)
        .msg('Log group already exists.');
    } else {
      log.error().err(error).msg('Failed to ensure log group exists');
      throw error;
    }
  }
}

// Function to generate the YAML configuration
function generateLogPipelineYaml(
  opensearchHost: string,
  indexName: string,
  region: string,
  stsRoleArn: string,
  queueUrl: string,
  indexMapping: string
) {
  return `
version: "2"
log-pipeline:
  source:
    s3:
      acknowledgments: true
      notification_type: "sqs"
      compression: "gzip"
      codec:
        newline:
      sqs:
        queue_url: "${queueUrl}"
        maximum_messages: 10
        visibility_timeout: "60s"
        visibility_duplication_protection: true
      aws:
        region: "${region}"
        sts_role_arn: "${stsRoleArn}"
  processor:
    - parse_json:
    - date:
        from_time_received: true
        destination: "ingest_timestamp"
    - delete_entries:
        with_keys: ["s3"]
  sink:
    - opensearch:
        hosts: ["${opensearchHost}"]
        index: "${indexName}-%{yyyy.MM.dd}"
        index_type: "custom"
        template_content: |
          ${indexMapping}
        aws:
          serverless: false
          region: "${region}"
          sts_role_arn: "${stsRoleArn}"
`;
}

const createS3Notification = (event: any) => {
  const eventData = event.detail;
  const s3BucketArn = eventData.resources.find(
    (resource: any) => resource.type === 'AWS::S3::Bucket'
  ).ARN;

  const s3Notification = {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: eventData.awsRegion,
        eventTime: eventData.eventTime,
        eventName: 'ObjectCreated:Put',
        s3: {
          bucket: {
            name: eventData.requestParameters.bucketName,
            arn: s3BucketArn,
          },
          object: {
            key: eventData.requestParameters.key,
            size: eventData.additionalEventData.bytesTransferredIn,
          },
        },
      },
    ],
  };

  return s3Notification;
};

async function createOrUpdateISMPolicy(log: any) {
  const policyName = 'delete_logs_after_90_days';
  const policy = {
    policy: {
      description: 'Manage index lifecycle',
      default_state: 'hot',
      states: [
        {
          name: 'hot',
          actions: [],
          transitions: [
            {
              state_name: 'delete',
              conditions: {
                min_index_age: '1d',
              },
            },
          ],
        },
        {
          name: 'delete',
          actions: [
            {
              delete: {},
            },
          ],
          transitions: [],
        },
      ],
      ism_template: [
        {
          index_patterns: ['test*'],
          priority: 1,
        },
      ],
    },
  };

  const policyPath = `/_plugins/_ism/policies/${policyName}`;

  //Fetch the existing policy version
  const policyVersion: any = await fetchPolicy(policyPath, log);

  //Update the policy
  await post(
    policyPath,
    policy,
    policyVersion?.seq_no,
    policyVersion?.primary_term,
    log
  );

  //Update role mappings
  const opensearchRoleArn = process.env.OSIS_ROLE_ARN || ''; //TODO to be uncommented and change call location
  await updateRoleMapping(
    OPEN_SEARCH_ENDPOINT,
    opensearchRoleArn,
    'all_access',
    log
  );
}

async function post(
  policyPath: string,
  bodyObject: any,
  seqNo: string,
  primaryTerm: string,
  log: any
): Promise<any> {
  const queryParams: Record<string, any> = {};
  if (seqNo !== null && primaryTerm !== null) {
    queryParams.if_seq_no = seqNo;
    queryParams.if_primary_term = primaryTerm;
  }

  try {
    const client = await getOpenSearchClient();

    // TODO Do not use http, please use the client directly and the functionality it provides
    const response = await client.http.put({
      path: policyPath,
      body: bodyObject,
      querystring: queryParams,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.statusCode === 200) {
      log
        .info()
        .str('response', response.body)
        .msg('ISM policy updated successfully');
      return response.body;
    } else {
      log.error().err(response).msg('Failed to update ISM policy');
      throw new Error(
        `Failed to update ISM policy with status: ${response.statusCode}`
      );
    }
  } catch (e: any) {
    log.error().err(e).msg('Error processing request');
    throw new Error(`Error processing request: ${e.message}`);
  }
}

async function fetchPolicy(
  policyPath: string,
  log: any
): Promise<{seq_no: number; primary_term: number} | null> {
  try {
    const client = await getOpenSearchClient();

    log.info(`Making request to ${policyPath}`);

    // TODO Do not use http, please use the client directly and the functionality it provides
    const response = await client.http.get({
      path: policyPath,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.statusCode === 200) {
      const data = response.body;
      if (
        data &&
        data._seq_no !== undefined &&
        data._primary_term !== undefined
      ) {
        return {
          seq_no: data._seq_no,
          primary_term: data._primary_term,
        };
      } else {
        log.error().err(data).msg('Required fields not found in the response');
        return null;
      }
    } else {
      log.error().err(response).msg('Failed to fetch policy');
      throw new Error(`Request failed with status: ${response.statusCode}`);
    }
  } catch (error: any) {
    log.error().err(error.message).msg('Error fetching policy');
    throw new Error(`Error fetching policy: ${error.message}`);
  }
}

// async function createNewPolicyForLogGroup(
//   logGroupName: string,
//   pipelineName: string,
//   log: any
// ) {
//   const policyName = `LogPolicy_${pipelineName}`;
//   const stsClient = new STSClient({region: REGION});
//   const cwLogsClient = new CloudWatchLogsClient({});
//
//   const {Account: accountId} = await stsClient.send(
//     new GetCallerIdentityCommand({})
//   );
//
//   const policyDocument = JSON.stringify({
//     Version: '2012-10-17',
//     Statement: [
//       {
//         Effect: 'Allow',
//         Principal: {Service: 'delivery.logs.amazonaws.com'},
//         Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
//         Resource: [
//           `arn:aws:logs:${REGION}:${accountId}:log-group:${logGroupName}:log-stream:*`,
//         ],
//         Condition: {
//           StringEquals: {'aws:SourceAccount': accountId},
//           ArnLike: {
//             'aws:SourceArn': `arn:aws:logs:${REGION}:${accountId}:log-group:${logGroupName}`,
//           },
//         },
//       },
//     ],
//   });
//
//   log.info().msg(`Creating new resource policy for log group ${logGroupName}.`);
//   try {
//     await cwLogsClient.send(
//       new PutResourcePolicyCommand({
//         policyName: policyName,
//         policyDocument: policyDocument,
//       })
//     );
//     log
//       .info()
//       .msg(
//         `New resource policy ${policyName} created for log group ${logGroupName}.`
//       );
//   } catch (error) {
//     log
//       .error()
//       .err(error)
//       .msg(
//         `Failed to create new resource policy for log group ${logGroupName}.`
//       );
//     throw error;
//   }
// }

async function updateRoleMapping(
  opensearchHost: string,
  stsRoleArn: string,
  roleName: string,
  log: any
) {
  const path = `/_plugins/_security/api/rolesmapping/${roleName}`;
  const body = {
    backend_roles: [
      stsRoleArn,
      'arn:aws:iam::534914120180:role/Overwatch-MasterRole7C9FAFA5-jGxU2chJe0Ik',
    ],
    hosts: [],
  };

  try {
    const client = await getOpenSearchClient();

    // TODO Do not use http, please use the client directly and the functionality it provides
    const response = await client.http.put({
      path: path,
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.statusCode === 200) {
      log.info().str('response', response.body).msg('Role mapping updated');
      return response.body;
    } else {
      log.error().err(response).msg('Failed to update role mapping');
      throw new Error(
        `Failed to update role mapping with status: ${response.statusCode}`
      );
    }
  } catch (error: any) {
    log.error().err(error).msg('Error processing request');
    throw new Error(`Failed to update role mapping: ${error.message}`);
  }
}

// Main handler function
export async function handler(event: any): Promise<void> {
  await logging.initialize({
    svc: 'overwatch',
    level: 'trace',
  });

  log.trace().unknown('event', event).msg('Received S3 event'); //TODO: Remove for PROD deployment

  //Validate region env var
  if (!REGION) {
    log.error().msg('Cannot find env var OS_REGION');
    return;
  }
  const {bucketName, objectKey} = extractBucketDetails(event);
  if (!bucketName || !objectKey) {
    log.error().msg('Missing bucket name or object key in the event detail');
    return;
  }

  const indexName = extractIndexName(objectKey);
  const pipelineName = `ingestion-pipeline-${indexName}`;

  const queueUrl = await createQueueIfNeeded(indexName, log);
  const messageBody = createS3Notification(event);

  await sendMessageToQueue(queueUrl, messageBody, log);
  await ensurePipelineExists(pipelineName, indexName, queueUrl, log);
}
