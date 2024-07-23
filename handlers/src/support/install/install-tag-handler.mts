import * as logging from '@nr1e/logging';
import {EventBridgeEvent, EventBridgeHandler} from 'aws-lambda';

const log = logging.initialize({
  svc: 'install-tag-handler',
  level: 'trace',
});

export const handler: EventBridgeHandler<string, string, void> = async (
  event: EventBridgeEvent<string, string>,
) => {
  log.trace().obj('event', event).msg('Received event');
};
