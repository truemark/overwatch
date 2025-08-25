import {AwsSigv4Signer} from '@opensearch-project/opensearch/aws';
import {
  AssumeRoleCommand,
  AssumeRoleCommandOutput,
  STSClient,
} from '@aws-sdk/client-sts';
import {Client} from '@opensearch-project/opensearch';
import {DeepPartial} from './ts-helper.mjs';

const stsClient = new STSClient({});

interface EnvConfig {
  readonly masterRoleArn: string;
  readonly endpoint: string;
  readonly region: string;
}

let config: EnvConfig | null = null;

function getConfig(): EnvConfig {
  if (config !== null) {
    return config;
  }
  const masterRoleArn = process.env.OPEN_SEARCH_MASTER_ROLE_ARN;
  if (!masterRoleArn) {
    throw new Error('OPEN_SEARCH_MASTER_ROLE_ARN is required');
  }
  const endpoint = process.env.OPEN_SEARCH_ENDPOINT;
  if (!endpoint) {
    throw new Error('OPEN_SEARCH_ENDPOINT is required');
  }
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error('AWS_REGION is required');
  }
  config = {
    masterRoleArn,
    endpoint,
    region,
  };
  return config;
}

export function getOpenSearchEndpoint(): string {
  return getConfig().endpoint;
}

export interface IsmPolicy {
  policy_id: string;
  description: string;
  last_updated_time: number;
  schema_version: number;
  default_state: string;
  states: Array<{
    name: string;
    actions: Array<{
      warm_migration: object;
      action_type: string;
      retry: {
        count: number;
        backoff: string;
        delay: string;
      };
      throttle: {
        value: number;
        unit: string;
      };
      delete: object;
    }>;
    transitions: null | Array<{
      state_name: string;
      conditions: {
        min_index_age: string;
      };
    }>;
  }>;
  ism_template: Array<{
    index_patterns: string[];
    priority: number;
  }>;
}

export type PartialIsmPolicy = DeepPartial<IsmPolicy>;

export interface IsmPolicyVersion {
  _id: string;
  _version: number;
  _seq_no: number;
  _primary_term: number;
  policy: IsmPolicy;
}

export interface RoleMapping {
  hosts: string[];
  users: string[];
  reserved: boolean;
  hidden: boolean;
  backend_roles: string[];
  and_backend_roles: string[];
}

export type RolesMapping = Record<string, RoleMapping>;

export interface RoleMappingUpdate {
  hosts: string[];
  users: string[];
  backend_roles: string[];
}

export interface IndexPatternConfig {
  title: string;
  timeFieldName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields?: any;
}

export class OpenSearchClient extends Client {
  ism = {
    getPolicy: async (policyId: string): Promise<IsmPolicyVersion | null> => {
      const path = `/_plugins/_ism/policies/${policyId}`;
      const {body} = await this.transport.request({
        method: 'GET',
        path,
      });
      if (!body) {
        return null;
      }
      return body as IsmPolicyVersion;
    },

    updatePolicy: async (
      policyId: string,
      policy: PartialIsmPolicy,
      seqNo?: number,
      primaryTerm?: number,
    ): Promise<any> => {
      const path = `/_plugins/_ism/policies/${policyId}`;
      const querystring: Record<string, string | number> = {};
      if (seqNo && primaryTerm) {
        querystring.if_seq_no = seqNo;
        querystring.if_primary_term = primaryTerm;
      }
      const {body} = await this.transport.request({
        method: 'PUT',
        path,
        querystring,
        body: {policy},
      });

      return body;
    },
  };

  sec = {
    getRoleMapping: async (name: string): Promise<RoleMapping | null> => {
      const path = `/_plugins/_security/api/rolesmapping/${name}`;
      const {body} = await this.transport.request({
        method: 'GET',
        path,
      });
      if (body[name] === undefined) {
        return null;
      }
      return body[name];
    },

    updateRoleMapping: async (
      name: string,
      mapping: RoleMappingUpdate,
    ): Promise<any> => {
      const path = `/_plugins/_security/api/rolesmapping/${name}`;
      const {body} = await this.transport.request({
        method: 'PUT',
        path,
        body: {
          // Done to strip out extra properties
          hosts: mapping.hosts,
          users: mapping.users,
          backend_roles: mapping.backend_roles,
        },
      });

      return body;
    },

    updateRole: async (name: string, roleDefinition: any): Promise<any> => {
      const path = `/_plugins/_security/api/roles/${name}`;
      const {body} = await this.transport.request({
        method: 'PUT',
        path,
        body: roleDefinition,
      });

      return body;
    },
  };

  kib = {
    createIndexPattern: async (
      indexPatternId: string,
      config: IndexPatternConfig,
    ): Promise<void> => {
      const path = `/.kibana_1/_doc/index-pattern:${indexPatternId}`;
      await this.transport.request({
        method: 'PUT',
        path,
        body: {
          'type': 'index-pattern',
          'index-pattern': {
            title: config.title,
            timeFieldName: config.timeFieldName,
            fields: config.fields,
          },
        },
      });
    },
  };
}

export async function getOpenSearchClient(): Promise<OpenSearchClient> {
  const response: AssumeRoleCommandOutput = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: getConfig().masterRoleArn,
      RoleSessionName: 'overwatch-config-handler',
    }),
  );
  if (response.Credentials === undefined) {
    throw new Error('No credentials returned from AssumeRole');
  }
  const credentials = {
    accessKeyId: response.Credentials.AccessKeyId!,
    secretAccessKey: response.Credentials.SecretAccessKey!,
    sessionToken: response.Credentials.SessionToken!,
  };
  return new OpenSearchClient({
    ...AwsSigv4Signer({
      region: getConfig().region,
      getCredentials: async () => {
        return credentials;
      },
    }),
    node: getConfig().endpoint,
  });
}
