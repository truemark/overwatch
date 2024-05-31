import * as logging from '@nr1e/logging';
import {
  getOpenSearchClient,
  OpenSearchClient,
  PartialIsmPolicy,
} from './open-search-helper';

const log = logging.getLogger('config-handler');

function getOpenSearchAccessRoleArn(): string {
  const openSearchAccessRoleArn = process.env.OPEN_SEARCH_ACCESS_ROLE_ARN;
  if (!openSearchAccessRoleArn) {
    throw new Error('OPEN_SEARCH_ACCESS_ROLE_ARN is not set.');
  }
  return openSearchAccessRoleArn;
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
              min_index_age: '5d', //TODO Change for 90 for Prod
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

async function updateRoleMappings(client: OpenSearchClient) {
  const allAccessRoleMapping = await client.sec.getRoleMapping('all_access');
  if (!allAccessRoleMapping) {
    throw new Error('Role mapping all_access not found.');
  }
  const accessRoleArn = getOpenSearchAccessRoleArn();
  if (!allAccessRoleMapping.backend_roles.includes(accessRoleArn)) {
    allAccessRoleMapping.backend_roles.push(accessRoleArn);
  }
  await client.sec.updateRoleMapping('all_access', allAccessRoleMapping);
}

export async function handler(): Promise<void> {
  await logging.initialize({
    level: 'debug',
    svc: 'overwatch',
  });
  const client = await getOpenSearchClient();
  await createOrUpdateISMPolicy(client);
  await updateRoleMappings(client);
  return;
}
