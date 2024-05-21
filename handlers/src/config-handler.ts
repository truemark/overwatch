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
  await createOrUpdateISMPolicy(log);
  return;
}
async function createOrUpdateISMPolicy(log: any) {
  const policyName = 'delete_logs_after_90_days';
  const policy = {
    policy: {
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
                min_index_age: '1d',
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
    },
  };

  const policyPath = `/_plugins/_ism/policies/${policyName}`;

  //Fetch the existing policy version
  const policyVersion: any = await fetchPolicy(policyPath, log);

  //Update the policy
  await post(
    policyPath,
    policy,
    policyVersion?.seq_no,
    policyVersion?.primary_term,
    log
  );
}
async function fetchPolicy(
  policyPath: string,
  log: any
): Promise<{seq_no: number; primary_term: number} | null> {
  try {
    const client = await getOpenSearchClient();

    log.info(`Making request to ${policyPath}`);

    const response = await client.http.get({
      path: policyPath,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.statusCode === 200) {
      const data = response.body;
      if (
        data &&
        data._seq_no !== undefined &&
        data._primary_term !== undefined
      ) {
        return {
          seq_no: data._seq_no,
          primary_term: data._primary_term,
        };
      } else {
        log.error().err(data).msg('Required fields not found in the response');
        return null;
      }
    } else {
      log.error().err(response).msg('Failed to fetch policy');
      throw new Error(`Request failed with status: ${response.statusCode}`);
    }
  } catch (error: any) {
    log.error().err(error.message).msg('Error fetching policy');
    throw new Error(`Error fetching policy: ${error.message}`);
  }
}
async function post(
  policyPath: string,
  bodyObject: any,
  seqNo: string,
  primaryTerm: string,
  log: any
): Promise<any> {
  const queryParams: Record<string, any> = {};
  if (seqNo !== null && primaryTerm !== null) {
    queryParams.if_seq_no = seqNo;
    queryParams.if_primary_term = primaryTerm;
  }

  try {
    const client = await getOpenSearchClient();

    const response = await client.http.put({
      path: policyPath,
      body: bodyObject,
      querystring: queryParams,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.statusCode === 200) {
      log
        .info()
        .str('response', response.body)
        .msg('ISM policy updated successfully');
      return response.body;
    } else {
      log.error().err(response).msg('Failed to update ISM policy');
      throw new Error(
        `Failed to update ISM policy with status: ${response.statusCode}`
      );
    }
  } catch (e: any) {
    log.error().err(e).msg('Error processing request');
    throw new Error(`Error processing request: ${e.message}`);
  }
}
