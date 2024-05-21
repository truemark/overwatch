import * as opensearch from '@opensearch-project/opensearch';
import {AwsSigv4Signer} from '@opensearch-project/opensearch/aws';
import {
  AssumeRoleCommand,
  AssumeRoleCommandOutput,
  STSClient,
} from '@aws-sdk/client-sts';

export const OPEN_SEARCH_MASTER_ROLE_ARN =
  process.env.OPEN_SEARCH_MASTER_ROLE_ARN;
if (!OPEN_SEARCH_MASTER_ROLE_ARN) {
  throw new Error('OPEN_SEARCH_MASTER_ROLE_ARN is required');
}

export const OPEN_SEARCH_ENDPOINT = process.env.OPEN_SEARCH_ENDPOINT;
if (!OPEN_SEARCH_ENDPOINT) {
  throw new Error('OPEN_SEARCH_ENDPOINT is required');
}

const stsClient = new STSClient({});

export async function getOpenSearchClient(): Promise<opensearch.Client> {
  const response: AssumeRoleCommandOutput = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: OPEN_SEARCH_MASTER_ROLE_ARN,
      RoleSessionName: 'overwatch-config-handler',
    })
  );
  if (response.Credentials === undefined) {
    throw new Error('No credentials returned from AssumeRole');
  }
  const credentials = {
    accessKeyId: response.Credentials.AccessKeyId!,
    secretAccessKey: response.Credentials.SecretAccessKey!,
    sessionToken: response.Credentials.SessionToken!,
  };
  return new opensearch.Client({
    ...AwsSigv4Signer({
      region: process.env.AWS_REGION!,
      getCredentials: async () => {
        return credentials;
      },
    }),
    node: OPEN_SEARCH_ENDPOINT,
  });
}
