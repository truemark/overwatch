import {test} from 'vitest';

import {getOpenSearchClient, PartialIsmPolicy} from './open-search-helper.mjs';

function skip(): boolean {
  if (process.env.OPEN_SEARCH_MASTER_ROLE_ARN === undefined) {
    console.log('Skipping test because OPEN_SEARCH_MASTER_ROLE_ARN is not set');
    return true;
  }
  if (process.env.OPEN_SEARCH_ENDPOINT === undefined) {
    console.log('Skipping test because OPEN_SEARCH_ENDPOINT is not set');
    return true;
  }
  if (process.env.AWS_REGION === undefined) {
    console.log('Skipping test because AWS_REGION is not set');
    return true;
  }
  return false;
}

test('Get Policy', async () => {
  if (skip()) {
    return;
  }
  const policyId = 'delete_logs_after_90_days';
  const client = await getOpenSearchClient();
  const policyVersion = await client.ism.getPolicy(policyId);
  console.log(JSON.stringify(policyVersion, null, 2));
});

test('Update Policy', async () => {
  if (skip()) {
    return;
  }

  const policyId = 'delete_logs_after_90_days';
  const client = await getOpenSearchClient();

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
  await client.ism.updatePolicy(
    policyId,
    policy,
    policyVersion?._seq_no,
    policyVersion?._primary_term,
  );
});

test('Get Role Mapping', async () => {
  if (skip()) {
    return;
  }
  const client = await getOpenSearchClient();

  const mapping = await client.sec.getRoleMapping('all_access');
  console.log(JSON.stringify(mapping, null, 2));
});

test('Update Role Mapping', async () => {
  if (skip()) {
    return;
  }
  const client = await getOpenSearchClient();
  const mapping = await client.sec.getRoleMapping('all_access');
  if (mapping === null) {
    throw new Error('Mapping for role all_access not found');
  }
  await client.sec.updateRoleMapping('all_access', mapping);
});
