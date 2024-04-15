import {
  OSISClient,
  CreatePipelineCommand,
  GetPipelineCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-osis';
import {initialize} from '@nr1e/logging';
const osisClient = new OSISClient({region: 'us-west-2'}); // Todo Adjust the region appropriately

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

  const pipelineConfigurationBody = generateLogPipelineYaml(
    '/log/ingest',
    'https://search-os-logs-domain-7vhcl27kveefe6xmgiupjohldq.us-west-2.es.amazonaws.com',
    indexName,
    'us-west-2',
    'arn:aws:iam::381492266277:role/Overwatch-OverwatchElasticsrchAccessRoleDA353646-Rlu4VhBWWDji'
  );

  try {
    const input = {
      PipelineName: pipelineName,
      MinUnits: 1,
      MaxUnits: 5,
      PipelineConfigurationBody: pipelineConfigurationBody,
      LogPublishingOptions: {
        IsLoggingEnabled: false,
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

// Function to generate the YAML configuration
function generateLogPipelineYaml(
  httpPath: string,
  opensearchHost: string,
  indexName: string,
  region: string,
  stsRoleArn: string
) {
  return `
version: "2"
log-pipeline:
  source:
    http:
      path: "${httpPath}"
  processor:
    - date:
        from_time_received: true
        destination: "@timestamp"
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
