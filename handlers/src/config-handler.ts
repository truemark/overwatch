import * as logging from '@nr1e/logging';
import {
  getOpenSearchClient,
  OpenSearchClient,
  PartialIsmPolicy,
} from './open-search-helper';

const log = logging.getLogger('config-handler');

export async function handler(): Promise<void> {
  await logging.initialize({
    level: 'debug',
    svc: 'overwatch',
  });
  const client = await getOpenSearchClient();
  await createOrUpdateISMPolicy(client);
  return;
}
async function createOrUpdateISMPolicy(client: OpenSearchClient) {
  const policyId = 'delete_logs_after_90_days';
  const policy: PartialIsmPolicy = {
    description: 'Manage index lifecycle',
    default_state: 'hot',
    states: [
      {
        name: 'hot',
        actions: [],
        transitions: [
          {
            state_name: 'delete',
            conditions: {
              min_index_age: '90d',
            },
          },
        ],
      },
      {
        name: 'delete',
        actions: [
          {
            delete: {},
          },
        ],
        transitions: [],
      },
    ],
    ism_template: [
      {
        index_patterns: ['logs-*'],
        priority: 100,
      },
    ],
  };

  const policyVersion = await client.ism.getPolicy(policyId);
  if (policyVersion === null) {
    throw new Error(`Policy ${policyId} not found.`);
  }

  await client.ism.updatePolicy(
    policyId,
    policy,
    policyVersion._seq_no,
    policyVersion._primary_term
  );
  log.info().str('policyId', policyId).msg('Policy updated');
}
