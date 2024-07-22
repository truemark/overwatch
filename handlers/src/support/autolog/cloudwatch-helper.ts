import * as logging from '@nr1e/logging';
import {
  CloudWatchLogsClient,
  DeleteSubscriptionFilterCommand,
  DescribeSubscriptionFiltersCommand,
  ListTagsForResourceCommand,
  PutSubscriptionFilterCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import * as arnp from '@aws-sdk/util-arn-parser';

const log = logging.getLogger('cloudwatch-helper');
const client = new CloudWatchLogsClient({});

export function parseLogGroupName(arn: string): string {
  return arnp.parse(arn).resource.replace('log-group:', '');
}

export interface LogGroupTags {
  readonly dest: string;
}

export async function getLogGroupTags(
  arn: string
): Promise<LogGroupTags | null> {
  const response = await client.send(
    new ListTagsForResourceCommand({
      resourceArn: arn,
    })
  );
  if (response.tags !== undefined) {
    if (response.tags['autolog:dest'] !== undefined) {
      const tags: LogGroupTags = {
        dest: response.tags['autolog:dest'],
      };
      log.trace().unknown('tags', tags).str('arn', arn).msg('Retrieved tags');
      return tags;
    }
  }
  return null;
}

export interface GetSubscriptionFilterProps {
  readonly logGroupName: string;
  readonly filterName: string;
}

export interface SubscriptionFilterDetails {
  readonly name: string;
  readonly destination: string;
}

export async function getSubscriptionFilter(
  props: GetSubscriptionFilterProps
): Promise<SubscriptionFilterDetails | null> {
  const command = new DescribeSubscriptionFiltersCommand({
    logGroupName: props.logGroupName,
    filterNamePrefix: 'AutoLog',
  });
  const response = await client.send(command);
  const filter = (response.subscriptionFilters ?? []).find(
    filter => filter.filterName === props.filterName
  );
  if (filter) {
    log
      .trace()
      .obj('subscriptionFilter', filter)
      .msg('Retrieved subscription filter');
    return {
      name: filter.filterName!,
      destination: filter.destinationArn!,
    };
  } else {
    log
      .trace()
      .obj('response', response)
      .str('filterName', props.filterName)
      .msg('Subscription filter not found');
    return null;
  }
}

export interface CreateSubscriptionFilterProps {
  readonly logGroupName: string;
  readonly deliveryStreamArn: string;
  readonly roleArn: string;
}

export async function createOrUpdateSubscriptionFilter(
  props: CreateSubscriptionFilterProps
): Promise<string> {
  const command = new PutSubscriptionFilterCommand({
    logGroupName: props.logGroupName,
    filterName: 'AutoLog',
    filterPattern: '',
    // filterPattern: '{$.all = *}',
    destinationArn: props.deliveryStreamArn,
    roleArn: props.roleArn,
    distribution: 'ByLogStream',
  });
  const response = await client.send(command);
  log.trace().unknown('response', response).msg('Created subscription filter');
  return command.input.filterName!;
}

export interface DeleteSubscriptionFilterProps {
  readonly logGroupName: string;
  readonly filterName: string;
}

export async function deleteSubscriptionFilter(
  props: DeleteSubscriptionFilterProps
): Promise<void> {
  const command = new DeleteSubscriptionFilterCommand({
    logGroupName: props.logGroupName,
    filterName: props.filterName,
  });
  const response = await client.send(command);
  log.trace().unknown('response', response).msg('Deleted subscription filter');
}
