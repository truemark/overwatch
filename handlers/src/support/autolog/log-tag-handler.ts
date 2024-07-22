import * as logging from '@nr1e/logging';
import {
  createOrUpdateSubscriptionFilter,
  deleteSubscriptionFilter,
  getLogGroupTags,
  getSubscriptionFilter,
  LogGroupTags,
  parseLogGroupName,
} from './cloudwatch-helper';
import {
  createDeliveryStream,
  getDeliveryStream,
  waitForDeliveryStreamActivation,
} from './firehose-helper';

const log = logging.getRootLogger();

interface TagEvent {
  source: string;
  resources: string[];
}

function isTagEvent(event: unknown): event is TagEvent {
  return (
    (event as TagEvent).source === 'aws.tag' &&
    Array.isArray((event as TagEvent).resources)
  );
}

interface LogGroupEvent {
  source: string;
  detail: LogGroupEventDetail;
}

interface LogGroupEventDetail {
  requestParameters: LogGroupEventRequestParameters;
  eventName: string;
}

interface LogGroupEventRequestParameters {
  logGroupName: string;
}

function isLogGroupEvent(event: unknown): event is LogGroupEvent {
  return (
    (event as LogGroupEvent).source === 'aws.logs' &&
    ((event as LogGroupEvent).detail.eventName === 'CreateLogGroup' ||
      (event as LogGroupEvent).detail.eventName === 'DeleteLogGroup')
  );
}

async function handleDeleteTagEvent(logGroupName: string) {
  // If no tags exists, delete subscription filter
  const details = await getSubscriptionFilter({
    logGroupName,
    filterName: 'AutoLog',
  });
  if (details !== null) {
    // Only delete if the destination exists
    await deleteSubscriptionFilter({
      logGroupName,
      filterName: 'AutoLog',
    });
  }
  // TODO We need to check if we can delete the delivery stream which may be shared
}

interface HandleUpdateTagEventProps {
  logGroupName: string;
  tags: LogGroupTags;
  deliveryStreamRoleArn: string;
  deliveryStreamLogGroupName: string;
  subscriptionFilterStreamRoleArn: string;
}

async function handleUpdateTagEvent(props: HandleUpdateTagEventProps) {
  const parts = props.tags.dest.split('/');
  if (parts.length !== 2) {
    log.error().str('dest', props.tags.dest).msg('Invalid destination');
    return;
  }
  const bucketName = parts[0];
  const indexName = parts[1];
  const name = `AutoLog-${bucketName}-${indexName}`;
  let details = await getDeliveryStream(name);
  if (details === null) {
    await createDeliveryStream({
      name,
      bucketName,
      indexName,
      roleArn: props.deliveryStreamRoleArn,
      logGroupName: props.deliveryStreamLogGroupName,
    });
  }
  details = await waitForDeliveryStreamActivation(name);
  await createOrUpdateSubscriptionFilter({
    logGroupName: props.logGroupName,
    deliveryStreamArn: details.arn,
    roleArn: props.subscriptionFilterStreamRoleArn,
  });
}

export async function handler(event: unknown): Promise<void> {
  await logging.initialize({
    svc: 'AutoLog',
    name: 'main-handler',
    level: 'trace',
  });

  const deliveryStreamRoleArn = process.env.DELIVERY_STREAM_ROLE_ARN;
  if (deliveryStreamRoleArn === undefined) {
    throw new Error('DELIVERY_STREAM_ROLE_ARN is required');
  }
  const subscriptionFilterStreamRoleArn =
    process.env.SUBSCRIPTION_FILTER_ROLE_ARN;
  if (subscriptionFilterStreamRoleArn === undefined) {
    throw new Error('SUBSCRIPTION_FILTER_ROLE_ARN is required');
  }
  const deliveryStreamLogGroupName = process.env.DELIVERY_STREAM_LOG_GROUP_NAME;
  if (deliveryStreamLogGroupName === undefined) {
    throw new Error('DELIVERY_STREAM_LOG_GROUP_NAME is required');
  }

  if (isTagEvent(event)) {
    log.trace().obj('event', event).msg('Received tag event');
    for (const resource of event.resources) {
      try {
        const logGroupName = parseLogGroupName(resource);
        const tags = await getLogGroupTags(resource);
        if (tags === null) {
          await handleDeleteTagEvent(logGroupName);
        } else {
          await handleUpdateTagEvent({
            logGroupName,
            tags,
            deliveryStreamRoleArn,
            deliveryStreamLogGroupName,
            subscriptionFilterStreamRoleArn,
          });
        }
      } catch (e) {
        log
          .error()
          .err(e)
          .obj('event', event)
          .msg('Error occurred processing event');
      }
    }
  } else if (isLogGroupEvent(event)) {
    log.trace().obj('event', event).msg('Received log group event');
  } else {
    log.error().unknown('event', event).msg('Unknown event');
  }
}
