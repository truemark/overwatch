import * as logging from '@nr1e/logging';
import {EventBridgeEvent, EventBridgeHandler} from 'aws-lambda';
import {
  SSMClient,
  SendCommandCommand,
  DescribeInstanceInformationCommand,
} from '@aws-sdk/client-ssm';

const log = logging.initialize({
  svc: 'install-tag-handler',
  level: 'trace',
});

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 30000; // 30 seconds

async function isInstanceSSMReachable(
  ssmClient: SSMClient,
  instanceId: string,
): Promise<boolean> {
  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      const command = new DescribeInstanceInformationCommand({});
      const response = await ssmClient.send(command);

      const instanceInfo = response.InstanceInformationList?.find(
        (instance) =>
          instance.InstanceId === instanceId &&
          instance.PingStatus === 'Online',
      );

      if (instanceInfo) {
        return true;
      }

      log.trace().msg(`Instance ${instanceId} is not reachable. Retrying...`);
    } catch (error) {
      log.error().msg(`Error while checking instance status: ${error}`);
    }

    retries += 1;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  return false;
}

export const handler: EventBridgeHandler<string, string, void> = async (
  event: EventBridgeEvent<string, string>,
) => {
  log.trace().obj('event', event).msg('Received event');

  log.trace().obj('event.resources', event.resources).msg('Resources');
  if (event.resources && event.resources.length > 0) {
    const instanceArn = event.resources[0];
    const instanceId = instanceArn.split('/').pop();

    log.trace().msg(`Extracted instance ID: ${instanceId}`);
    try {
      const ssmClient = new SSMClient({region: process.env.AWS_DEFAULT_REGION});

      if (await isInstanceSSMReachable(ssmClient, instanceId!)) {
        const tagValue = event.detail.tags['overwatch:install'];
        const commands: string[] = [];

        if (
          tagValue === 'all' ||
          (tagValue.includes('node-exporter') &&
            tagValue.includes('fluent-bit'))
        ) {
          commands.push('InstallNodeExporter', 'InstallFluentBit');
        } else if (tagValue.includes('node-exporter')) {
          commands.push('InstallNodeExporter');
        } else if (tagValue.includes('fluent-bit')) {
          commands.push('InstallFluentBit');
        }

        for (const commandName of commands) {
          const command = new SendCommandCommand({
            DocumentName: commandName,
            InstanceIds: [instanceId],
          });

          const response = await ssmClient.send(command);
          log
            .trace()
            .obj('SSM Response', response)
            .msg(`SSM command ${commandName} sent successfully`);
        }
      } else {
        log
          .error()
          .msg(
            `Instance ${instanceId} is not reachable after ${(MAX_RETRIES * RETRY_DELAY_MS) / 1000} seconds.`,
          );
      }
    } catch (error) {
      log.error().msg(`Failed to send SSM command: ${error}`);
    }
  } else {
    log.error().msg('No resources found in the event');
  }
};
