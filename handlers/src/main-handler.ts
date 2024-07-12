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
import {
  getOpenSearchEndpoint,
  getOpenSearchClient,
  OpenSearchClient,
} from './open-search-helper';

// Constants for configuration
const REGION = process.env.AWS_REGION!;

const log = logging.getLogger('main-handler');
const sqsClient = new SQSClient({});

// Extracts bucket name and object key from the event
function extractBucketDetails(event: any) {
  return {
    bucketName: event.detail.bucket.name,
    objectKey: event.detail.object.key,
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
  bucketName: string,
  log: any
) {
  const osisClient = new OSISClient({region: REGION});

  try {
    await osisClient.send(new GetPipelineCommand({PipelineName: pipelineName}));
    log
      .info()
      .str('pipelineName', pipelineName)
      .msg('Pipeline already exists.');
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      log
        .info()
        .str('pipelineName', pipelineName)
        .msg('Pipeline not found, creating new pipeline...');
      await createPipeline(pipelineName, indexName, queueUrl, bucketName, log);

      //Create index pattern
      const client = await getOpenSearchClient();
      await createIndexPattern(client, indexName);
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
  bucketName: string,
  log: any
) {
  const logGroupName = `/aws/vendedlogs/${pipelineName}`;
  await ensureLogGroupExists(logGroupName, pipelineName, log);
  const opensearchRoleArn = process.env.OSIS_ROLE_ARN || '';
  const pipelineConfigurationBody = generateLogPipelineYaml(
    `${getOpenSearchEndpoint()}`,
    indexName,
    REGION,
    opensearchRoleArn,
    bucketName,
    pipelineName,
    queueUrl,
    // TODO We want to adjust the number of shards dynamically between a min and max value passed in as parameters
    // TODO This means the code will need to handle updating already existing pipelines
    JSON.stringify({
      settings: {
        number_of_shards: 2,
        number_of_replicas: 0,
        refresh_interval: '30s',
        'index.queries.cache.enabled': true,
        'index.requests.cache.enable': true,
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
      IsLoggingEnabled: false,
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
    log.info().str('logGroupName', logGroupName).msg('Log group ensured.');
  } catch (error) {
    if ((error as Error).name === 'ResourceAlreadyExistsException') {
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
  bucketName: string,
  pipelineName: string,
  queueUrl: string,
  indexMapping: string
) {
  return `
version: "2"
log-pipeline:
  source:
    s3:
      acknowledgments: false
      notification_type: "sqs"
      compression: "gzip"
      records_to_accumulate: 1000
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
        index: "logs-${indexName}-%{yyyy.MM.dd}"
        index_type: "custom"
        bulk_size: 15
        template_content: |
          ${indexMapping}
        aws:
          serverless: false
          region: "${region}"
          sts_role_arn: "${stsRoleArn}"
        dlq:
          s3:
            bucket: "${bucketName}"
            key_path_prefix: "dlq/${pipelineName}/%{yyyy}/%{MM}/%{dd}"
            region: "${region}"
            sts_role_arn: "${stsRoleArn}"
`;
}

const createS3Notification = (event: any) => {
  const s3BucketArn = event.resources.find(
    (resource: string) =>
      resource === `arn:aws:s3:::${event.detail.bucket.name}`
  );

  const s3Notification = {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: event.region,
        eventTime: event.time,
        eventName: 'ObjectCreated:Put',
        s3: {
          bucket: {
            name: event.detail.bucket.name,
            arn: s3BucketArn,
          },
          object: {
            key: event.detail.object.key,
            size: event.detail.object.size,
          },
        },
      },
    ],
  };

  return s3Notification;
};

async function createIndexPattern(client: OpenSearchClient, indexName: string) {
  const indexPatternId = 'logs-' + indexName;
  const indexPatternConfig = {
    title: `${indexPatternId}*`,
    timeFieldName: 'ingest_timestamp',
    fields: JSON.stringify([
      {
        name: '@ingest_timestamp',
        type: 'date',
        searchable: true,
        aggregatable: true,
      },
    ]),
  };

  try {
    await client.kib.createIndexPattern(indexPatternId, indexPatternConfig);
    log
      .info()
      .str('indexPatternId', indexPatternId)
      .msg('Index pattern created');
  } catch (error) {
    log.error().err(error).msg('Error creating index pattern');
  }
}

// Main handler function
export async function handler(event: any): Promise<void> {
  await logging.initialize({
    svc: 'overwatch',
    level: 'trace',
  });

  // Enable for debugging if needed
  //log.trace().unknown('event', event).msg('Received S3 event');

  // Validate region env var
  if (!REGION) {
    log.error().msg('Cannot find env var OS_REGION');
    return;
  }

  // Extract bucket name and object key from the EventBridge event
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
  await ensurePipelineExists(
    pipelineName,
    indexName,
    queueUrl,
    bucketName,
    log
  );
}
