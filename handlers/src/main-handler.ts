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
import {initialize} from '@nr1e/logging';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutResourcePolicyCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {STSClient, GetCallerIdentityCommand} from '@aws-sdk/client-sts';

// Constants for configuration
const REGION = process.env.OS_REGION || '';
const sqsClient = new SQSClient({region: REGION});
const https = require('https');

// Main handler function
export async function handler(event: any): Promise<void> {
  const log = await initializeLogger();
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

// Initializes the logging service
async function initializeLogger() {
  return initialize({
    svc: 'Overwatch',
    name: 'main-handler',
    level: 'trace',
  });
}

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
    await createOrUpdateISMPolicy(log); //TODO to change the call location
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
  const opensearchHost = process.env.OS_ENDPOINT || '';
  const opensearchRoleArn = process.env.OSIS_ROLE_ARN || '';
  if (!opensearchHost || !opensearchRoleArn) {
    log.error().msg('Cannot find env vars OS_ENDPOINT or OSIS_ROLE_ARN');
    return;
  }
  const pipelineConfigurationBody = generateLogPipelineYaml(
    opensearchHost,
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
    await createNewPolicyForLogGroup(logGroupName, pipelineName, log);

    log.info().str('logGroupName', logGroupName).msg('Log group ensured.');
  } catch (error) {
    if ((error as Error).name === 'ResourceAlreadyExistsException') {
      //Always ensure policy is created
      await createNewPolicyForLogGroup(logGroupName, pipelineName, log);

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
                min_index_age: '1d', //TODO adjust the min_index_age to 90d
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
          index_patterns: ['test*'], //TODO adjust the index pattern
          priority: 1,
        },
      ],
    },
  };

  const opensearchHost = process.env.OS_ENDPOINT || '';
  const policyPath = '/_plugins/_ism/policies/' + policyName;

  //Fetch the existing policy version
  const policyVersion: any = await fetchPolicy(opensearchHost, policyPath);

  //Update the policy
  await post(
    opensearchHost,
    policyPath,
    policy,
    policyVersion?.seq_no,
    policyVersion?.primary_term,
    (error: any, success: any) => {
      if (error) {
        log.error().err(error).msg('Failed to post ISM policy');
      } else {
        log.info().msg('ISM policy posted successfully');
      }
    }
  );

  //Update role mappings
  const opensearchRoleArn = process.env.OSIS_ROLE_ARN || ''; //TODO to be uncommented and change call location
  await updateRoleMapping(opensearchHost, opensearchRoleArn, 'all_access', log);
}

async function post(
  endpoint: string,
  policyPath: string,
  bodyObject: any,
  seqNo: string | null | undefined,
  primaryTerm: string | null | undefined,
  callback: any
) {
  const body = JSON.stringify(bodyObject);

  // Append versioning parameters only if both are available
  if (seqNo !== null && primaryTerm !== null) {
    policyPath += `?if_seq_no=${seqNo}&if_primary_term=${primaryTerm}`;
  }

  const requestParams = buildRequest(endpoint, policyPath, 'PUT', body);

  const request = https
    .request(requestParams, (response: any) => {
      let responseBody = '';
      response.on('data', (chunk: any) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        try {
          let success, error;

          // Only try to parse if there's a response body to parse
          if (responseBody) {
            const info = JSON.parse(responseBody);

            if (response.statusCode >= 200 && response.statusCode < 299) {
              success = {
                attemptedItems: 1,
                successfulItems: info.errors ? 0 : 1,
                failedItems: info.errors ? 1 : 0,
              };
            }

            // Only consider it an error if info.errors is true or status code is not successful
            if (response.statusCode !== 200 || info.errors === true) {
              error = {statusCode: response.statusCode, responseBody: info};
            }
          } else {
            // If there's no response body but it's a success code
            if (response.statusCode >= 200 && response.statusCode < 299) {
              success = {attemptedItems: 1, successfulItems: 1, failedItems: 0};
            } else {
              error = {
                statusCode: response.statusCode,
                responseBody: 'No response body',
              };
            }
          }

          callback(error, success, response.statusCode);
        } catch (e: any) {
          callback({
            statusCode: 500,
            responseBody: 'Error parsing response: ' + e.message,
          });
        }
      });
    })
    .on('error', (e: any) => {
      callback({statusCode: 500, responseBody: 'Network error: ' + e.message});
    });

  request.write(body);
  request.end();
}

function buildRequest(
  endpoint: string,
  policyPath: string,
  method: string,
  body?: any
) {
  // eslint-disable-next-line node/no-unsupported-features/node-builtins
  const parsedUrl = new URL(endpoint);
  const base64Credentials = Buffer.from('logsadmin:Logs@admin1').toString(
    'base64'
  );

  return {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: policyPath,
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${base64Credentials}`, //TODO to be change to SAML auth
    },
    ...(body ? {'Content-Length': Buffer.byteLength(body)} : {}),
  };
}

async function fetchPolicy(endpoint: string, policyPath: string) {
  return new Promise((resolve, reject) => {
    const requestParams = buildRequest(endpoint, policyPath, 'GET');

    const req = https.request(requestParams, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          // Policy found, parse it and return the version details
          const response = JSON.parse(data);
          resolve({
            seq_no: response._seq_no,
            primary_term: response._primary_term,
          });
        } else if (res.statusCode === 404) {
          // Policy not found, resolve with null or a specific value to indicate absence
          resolve(null);
        } else {
          // Other errors, handle accordingly
          reject(new Error(`Failed to fetch policy: ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error: any) => reject(error));
    req.end();
  });
}

async function createNewPolicyForLogGroup(
  logGroupName: string,
  pipelineName: string,
  log: any
) {
  const policyName = `LogPolicy_${pipelineName}`;
  const stsClient = new STSClient({region: REGION});
  const cwLogsClient = new CloudWatchLogsClient({});

  const {Account: accountId} = await stsClient.send(
    new GetCallerIdentityCommand({})
  );

  const policyDocument = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {Service: 'delivery.logs.amazonaws.com'},
        Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: [
          `arn:aws:logs:${REGION}:${accountId}:log-group:${logGroupName}:log-stream:*`,
        ],
        Condition: {
          StringEquals: {'aws:SourceAccount': accountId},
          ArnLike: {
            'aws:SourceArn': `arn:aws:logs:${REGION}:${accountId}:log-group:${logGroupName}`,
          },
        },
      },
    ],
  });

  log.info().msg(`Creating new resource policy for log group ${logGroupName}.`);
  try {
    await cwLogsClient.send(
      new PutResourcePolicyCommand({
        policyName: policyName,
        policyDocument: policyDocument,
      })
    );
    log
      .info()
      .msg(
        `New resource policy ${policyName} created for log group ${logGroupName}.`
      );
  } catch (error) {
    log
      .error()
      .err(error)
      .msg(
        `Failed to create new resource policy for log group ${logGroupName}.`
      );
    throw error;
  }
}

async function updateRoleMapping(
  opensearchHost: string,
  stsRoleArn: string,
  roleName: string,
  log: any
) {
  const path = `/_plugins/_security/api/rolesmapping/${roleName}`;
  const body = JSON.stringify({
    backend_roles: [stsRoleArn],
    hosts: [],
    users: ['logsadmin'],
  });

  const requestParams = buildRequest(opensearchHost, path, 'PUT', body);

  return new Promise((resolve, reject) => {
    const req = https.request(requestParams, (res: any) => {
      let responseData = '';
      res.on('data', (chunk: any) => (responseData += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          log.info('Role mapping updated successfully');
          resolve(responseData);
        } else {
          log.error('Failed to update role mapping', {
            statusCode: res.statusCode,
            data: responseData,
          });
          reject(new Error('Failed to update role mapping'));
        }
      });
    });

    req.on('error', (error: any) => {
      log.error('Error updating role mapping:', error);
      reject(error);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}
