import * as logging from '@nr1e/logging';
import {getOpenSearchClient} from './open-search-helper';

const log = logging.getLogger('config-handler');

export async function handler(): Promise<void> {
  await logging.initialize({
    level: 'debug',
    svc: 'overwatch',
  });
  const client = await getOpenSearchClient();
  const info = await client.info();
  log.info().obj('info', info).msg('Retrieved OpenSearch info');
  return;
}
