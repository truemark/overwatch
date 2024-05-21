import * as opensearch from '@opensearch-project/opensearch';
import {AwsSigv4Signer} from '@opensearch-project/opensearch/aws';
import {
  AssumeRoleCommand,
  AssumeRoleCommandOutput,
  STSClient,
} from '@aws-sdk/client-sts';
import {HttpRequest} from '@smithy/protocol-http';
import {SignatureV4} from '@smithy/signature-v4';
import {Sha256} from '@aws-crypto/sha256-js';
import {NodeHttpHandler} from '@smithy/node-http-handler';
import {QueryParameterBag} from '@smithy/types';

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

async function getCredentials() {
  const response: AssumeRoleCommandOutput = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: OPEN_SEARCH_MASTER_ROLE_ARN,
      RoleSessionName: 'overwatch-config-handler',
    })
  );
  if (response.Credentials === undefined) {
    throw new Error('No credentials returned from AssumeRole');
  }
  return {
    accessKeyId: response.Credentials.AccessKeyId!,
    secretAccessKey: response.Credentials.SecretAccessKey!,
    sessionToken: response.Credentials.SessionToken!,
  };
}

export async function createSignedRequest(
  endpoint: string,
  path: string,
  method: string,
  body?: any,
  queryParams?: QueryParameterBag
): Promise<any> {
  // eslint-disable-next-line node/no-unsupported-features/node-builtins
  const url = new URL(endpoint);
  const bodyString = body ? JSON.stringify(body) : undefined;

  const headers: {[key: string]: string} = {
    'Content-Type': 'application/json',
    Host: url.hostname,
  };

  if (bodyString) {
    headers['Content-Length'] = Buffer.byteLength(bodyString).toString();
  }

  const request = new HttpRequest({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    method,
    path,
    query: queryParams,
    headers,
    body: bodyString,
  });

  const credentials = await getCredentials();

  const signer = new SignatureV4({
    credentials,
    region: process.env.AWS_REGION!,
    service: 'es',
    sha256: Sha256,
  });

  return signer.sign(request);
}

export async function executeSignedRequest(
  signedRequest: HttpRequest
): Promise<any> {
  const client = new NodeHttpHandler();
  const {response} = await client.handle(signedRequest);
  const responseBody = await new Promise<string>((resolve, reject) => {
    let data = '';
    response.body.on('data', (chunk: any) => {
      data += chunk;
    });
    response.body.on('end', () => {
      resolve(data);
    });
    response.body.on('error', (error: any) => {
      reject(error);
    });
  });
  return responseBody;
}
