import * as logging from '@nr1e/logging';
import {
  getOpenSearchClient,
  OpenSearchClient,
  PartialIsmPolicy,
} from './open-search-helper.mjs';
import {
  developerRoleDefinition,
  developerRoleMappings,
} from './role-definitions.mjs';
import {deleteLogsAfter90DaysPolicy} from './ism-policies.mjs';

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
  const policy: PartialIsmPolicy = deleteLogsAfter90DaysPolicy;

  try {
    // Retrieve the current policy version
    const policyVersion = await client.ism.getPolicy(policyId);

    // Check if the policy was found
    if (policyVersion === null) {
      throw new Error(`Policy ${policyId} not found.`);
    }

    // Attempt to update the policy
    const response = await client.ism.updatePolicy(
      policyId,
      policy,
      policyVersion._seq_no,
      policyVersion._primary_term,
    );

    // Check the response status
    if (response._version === policyVersion._version + 1) {
      log.info().str('policyId', policyId).msg('Policy updated successfully.');
    } else {
      log
        .error()
        .str('policyId', policyId)
        .str('response', response)
        .msg('Policy update failed.');
    }
  } catch (error) {
    // Catch any errors that occur during the process
    log
      .error()
      .str('policyId', policyId)
      .err(error)
      .msg('Failed to update policy.');
    throw error;
  }
}

async function updateRoleMappings(client: OpenSearchClient) {
  try {
    const roleName = 'all_access';
    // Retrieve the current role mapping
    const allAccessRoleMapping = await client.sec.getRoleMapping(roleName);

    // Check if the role mapping was found
    if (!allAccessRoleMapping) {
      throw new Error('Role mapping all_access not found.');
    }

    const accessRoleArn = getOpenSearchAccessRoleArn();

    // Check if the backend role is already included; if not, add it
    if (!allAccessRoleMapping.backend_roles.includes(accessRoleArn)) {
      allAccessRoleMapping.backend_roles.push(accessRoleArn);
    }

    // Attempt to update the role mapping
    const response = await client.sec.updateRoleMapping(
      roleName,
      allAccessRoleMapping,
    );

    // Check the status in the response
    if (response.status === 'CREATED' || response.status === 'OK') {
      log
        .info()
        .str('roleName', roleName)
        .msg('Role mapping updated successfully.');
    } else {
      log
        .warn()
        .str('roleName', roleName)
        .err(response)
        .msg(`Role mapping update returned status: ${response.status}`);
    }
  } catch (error) {
    log
      .error()
      .str('roleName', 'all_access')
      .err(error)
      .msg('Failed to update role mapping.');
    throw error;
  }
}

async function createOrUpdateDeveloperRole(client: OpenSearchClient) {
  const roleName = 'Developer';

  try {
    // Create/Update the role (creates the role if it doesn't exist)
    const response = await client.sec.updateRole(
      roleName,
      developerRoleDefinition,
    );
    // Check if the role was created or updated successfully
    if (response.status === 'CREATED' || response.status === 'OK') {
      // Update role mapping with backend roles
      await client.sec.updateRoleMapping(roleName, developerRoleMappings);
      log
        .info()
        .str('roleName', roleName)
        .msg('Role created/updated and role mapping applied.');
    } else {
      log
        .error()
        .str('roleName', roleName)
        .err(response)
        .msg('Role was not created/updated successfully.');
    }
  } catch (error) {
    log
      .error()
      .str('roleName', roleName)
      .err(error)
      .msg('Failed to create/update role or role mapping.');
    throw error;
  }
}

export async function handler(): Promise<void> {
  await logging.initialize({
    level: 'debug',
    svc: 'overwatch',
  });
  const client = await getOpenSearchClient();
  await createOrUpdateISMPolicy(client);
  await updateRoleMappings(client);
  await createOrUpdateDeveloperRole(client);
  return;
}
