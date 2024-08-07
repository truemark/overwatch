import {
  SQSClient,
  CreateQueueCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import * as logging from '@nr1e/logging';

// Constants for configuration
const REGION = process.env.AWS_REGION!;

const log = logging.initialize({
  svc: 'overwatchsupport',
  level: 'trace',
});

const sqsClient = new SQSClient({});

// Extracts bucket name and object key from the event
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// Creates an SQS queue if it doesn't exist
async function createQueueIfNeeded(
  indexName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log: any,
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
      }),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messageBody: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log: any,
) {
  try {
    const {MessageId} = await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(messageBody),
      }),
    );
    log.info().str('messageId', MessageId).msg('Message sent to SQS Queue');
  } catch (error) {
    log.error().err(error).msg('Failed to send message to SQS Queue');
    throw error;
  }
}

// async function ensureLogGroupExists(
//   logGroupName: string,
//   pipelineName: string,
//   // eslint-disable-next-line @typescript-eslint/no-explicit-any
//   log: any,
// ) {
//   const cwlClient = new CloudWatchLogsClient({region: REGION});
//
//   try {
//     // Try to create the log group (idempotent if it already exists)
//     await cwlClient.send(new CreateLogGroupCommand({logGroupName}));
//     // await createNewPolicyForLogGroup(logGroupName, pipelineName, log);
//
//     log.info().str('logGroupName', logGroupName).msg('Log group ensured.');
//   } catch (error) {
//     if ((error as Error).name === 'ResourceAlreadyExistsException') {
//       //Always ensure policy is created
//       // await createNewPolicyForLogGroup(logGroupName, pipelineName, log);
//
//       log
//         .info()
//         .str('logGroupName', logGroupName)
//         .msg('Log group already exists.');
//     } else {
//       log.error().err(error).msg('Failed to ensure log group exists');
//       throw error;
//     }
//   }
// }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createS3Notification = (event: any) => {
  const eventData = event.detail;
  const s3BucketArn = eventData.resources.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (resource: any) => resource.type === 'AWS::S3::Bucket',
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

// Main handler function
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handler(event: any): Promise<void> {
  log.trace().unknown('event', event).msg('Received Tagging event'); //TODO: Remove for PROD deployment

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
  // const pipelineName = `ingestion-pipeline-${indexName}`;

  const queueUrl = await createQueueIfNeeded(indexName, log);
  const messageBody = createS3Notification(event);

  await sendMessageToQueue(queueUrl, messageBody, log);
  //await ensurePipelineExists(pipelineName, indexName, queueUrl, log);
}
