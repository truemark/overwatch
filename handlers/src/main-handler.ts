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
} from '@aws-sdk/client-cloudwatch-logs';

// Constants for configuration
const REGION = 'us-west-2';
const osisClient = new OSISClient({region: REGION});
const sqsClient = new SQSClient({region: REGION});
const cwlClient = new CloudWatchLogsClient({region: REGION});

// Main handler function
export async function handler(event: any): Promise<void> {
  const log = await initializeLogger();
  log.trace().unknown('event', event).msg('Received S3 event');

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
  await ensureLogGroupExists(logGroupName, log);
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

  try {
    const response = await osisClient.send(new CreatePipelineCommand(input));
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
  const queueName = `${indexName}-queue`;
  try {
    const {QueueUrl} = await sqsClient.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: {
          DelaySeconds: '0',
          MessageRetentionPeriod: '345600',
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

async function ensureLogGroupExists(logGroupName: string, log: any) {
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
        source: "message"
    - delete_entries:
        with_keys: [ "s3", "message" ]
  sink:
    - opensearch:
        hosts: ["${opensearchHost}"]
        index: "${indexName}"
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
