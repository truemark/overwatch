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

const osisClient = new OSISClient({region: 'us-west-2'}); // Todo Adjust the region appropriately
const sqsClient = new SQSClient({region: 'us-west-2'}); // Match the region to your Lambda function

export async function handler(event: any): Promise<void> {
  const log = await initialize({
    svc: 'Overwatch',
    name: 'main-handler',
    level: 'trace',
  });

  log.trace().unknown('event', event).msg('Received S3 event');

  // Extract the bucket name and object key from the event
  const bucketName = event.detail.requestParameters.bucketName;
  const objectKey = event.detail.requestParameters.key;

  if (!bucketName || !objectKey) {
    log.error().msg('Missing bucket name or object key in the event detail');
    return; // Exit if necessary details are not present
  }

  const indexName = objectKey.split('/')[1]; // Assuming index name is part of the object key
  const pipelineName = `ingestion-pipeline-${indexName}`;

  //Check if Pipeline already exists
  try {
    const command = new GetPipelineCommand({
      PipelineName: pipelineName, // required
    });
    await osisClient.send(command);
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      // Handle the case where the pipeline does not exist
      console.error(
        'Pipeline not found,',
        pipelineName,
        ' creating new pipeline...'
      );
    } else {
      // Handle other possible exceptions
      console.error('Pipeline already exists:', error);
      return;
    }
  }

  // Create SQS Queue
  const queueUrl = (await createQueue(indexName)) ?? '';

  // Create message body, could be JSON string or simple message
  const messageBody = createS3Notification(event);

  await sendMessage(queueUrl, messageBody);

  const pipelineConfigurationBody = generateLogPipelineYaml(
    'https://search-os-logs-domain-7vhcl27kveefe6xmgiupjohldq.us-west-2.es.amazonaws.com',
    indexName,
    'us-west-2',
    'arn:aws:iam::381492266277:role/Overwatch-OverwatchElasticsrchAccessRoleDA353646-Rlu4VhBWWDji',
    queueUrl
  );

  try {
    const input = {
      PipelineName: pipelineName,
      MinUnits: 1,
      MaxUnits: 5,
      PipelineConfigurationBody: pipelineConfigurationBody,
      LogPublishingOptions: {
        IsLoggingEnabled: true,
        CloudWatchLogDestination: {
          LogGroup: `/aws/vendedlogs/${pipelineName}`,
        },
      },
      BufferOptions: {
        PersistentBufferEnabled: false,
      },
    };

    const command = new CreatePipelineCommand(input);
    const response = await osisClient.send(command);
    log
      .info()
      .str('pipelineName', pipelineName)
      .msg('Pipeline created successfully');
  } catch (error) {
    log.error().err(error).msg('Error creating pipeline');
  }
}

async function createQueue(indexName: string) {
  const queueName = `${indexName}-queue`; // Custom queue name based on the index
  try {
    const createQueueCommand = new CreateQueueCommand({
      QueueName: queueName,
      Attributes: {
        DelaySeconds: '0', // Customize attributes as needed
        MessageRetentionPeriod: '345600', // Example: 4 days in seconds
      },
    });
    const response = await sqsClient.send(createQueueCommand);
    console.log('SQS Queue created:', response.QueueUrl);
    return response.QueueUrl; // Return the new queue URL for further use
  } catch (error) {
    console.error('Failed to create SQS Queue:', error);
    throw error; // Re-throw the error to handle it in the caller function
  }
}

async function sendMessage(queueUrl: string, messageBody: any) {
  const params = {
    QueueUrl: queueUrl, // URL of the SQS queue
    MessageBody: JSON.stringify(messageBody), // Stringify your message body if it's not a string
  };

  try {
    const data = await sqsClient.send(new SendMessageCommand(params));
    console.log('Success, message sent. Message ID:', data.MessageId);
    return data; // Returns the response from the SDK
  } catch (err) {
    console.error('Error', err);
    throw err; // Optional: depending on your error handling you might want to throw the error further
  }
}

// Function to generate the YAML configuration
function generateLogPipelineYaml(
  opensearchHost: string,
  indexName: string,
  region: string,
  stsRoleArn: string,
  queueUrl: string
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
    - delete_entries:
      with_keys: [ "s3" ]
  sink:
    - opensearch:
        hosts: ["${opensearchHost}"]
        index: "${indexName}"
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
