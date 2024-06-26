import {Construct} from 'constructs';
import {CfnWorkspace} from 'aws-cdk-lib/aws-grafana';
import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {AwsCustomResource, AwsSdkCall} from 'aws-cdk-lib/custom-resources';
import {ExtendedConstruct} from 'truemark-cdk-lib/aws-cdk';
import {Stack} from 'aws-cdk-lib';
import * as crypto from 'crypto';

/**
 * Default version of Grafana to use.
 */
export const DEFAULT_GRAFANA_VERSION = '10.4';

/**
 * Properties for StandardWorkspace.
 */
export interface StandardWorkspaceProps {
  /**
   * Optional name of the workspace.
   */
  readonly name?: string;

  /**
   * Description to apply to the workspace.
   */
  readonly description?: string;

  /**
   * Version of grafana to use. Default is DEFAULT_GRAFANA_VERSION.
   */
  readonly version?: string;

  /**
   * Organizational units to allow the workspace to access if using Organization access.
   */
  readonly organizationalUnits?: string[];

  /**
   * AWS Identity Center groups to add as editors to the workspace.
   */
  readonly editorGroups?: string[];

  /**
   * AWS Identity Center groups to add as admins to the workspace.
   */
  readonly adminGroups?: string[];
}

/**
 * Creates a standard AWS managed Grafana workspace.
 */
export class StandardWorkspace extends ExtendedConstruct {
  readonly role: Role;
  readonly workspace: CfnWorkspace;
  constructor(scope: Construct, id: string, props: StandardWorkspaceProps) {
    super(scope, id);
    this.role = new Role(this, 'Role', {
      assumedBy: new ServicePrincipal('grafana.amazonaws.com'),
    });
    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'organizations:ListAccountsForParent',
          'organizations:ListOrganizationalUnitsForParent',
        ],
        resources: ['*'],
      })
    );
    this.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AmazonGrafanaCloudWatchAccess'
      )
    );
    this.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AmazonGrafanaAthenaAccess'
      )
    );

    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'es:ESHttpGet',
          'es:DescribeElasticsearchDomains',
          'es:ListDomainNames',
        ],
        resources: ['*'],
      })
    );
    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['es:ESHttpPost'],
        resources: [
          'arn:aws:es:*:*:domain/*/_msearch*',
          'arn:aws:es:*:*:domain/*/_opendistro/_ppl',
        ],
      })
    );
    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'aps:ListWorkspaces',
          'aps:DescribeWorkspace',
          'aps:QueryMetrics',
          'aps:GetLabels',
          'aps:GetSeries',
          'aps:GetMetricMetadata',
        ],
        resources: ['*'],
      })
    );
    this.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AWSXrayReadOnlyAccess')
    );
    this.workspace = new CfnWorkspace(this, 'Grafana', {
      name: props?.name,
      description: props.description,
      accountAccessType: 'ORGANIZATION',
      organizationalUnits: props?.organizationalUnits,
      authenticationProviders: ['AWS_SSO'],
      permissionType: 'SERVICE_MANAGED',
      roleArn: this.role.roleArn,
      grafanaVersion: props?.version ?? DEFAULT_GRAFANA_VERSION,
      dataSources: [
        'AMAZON_OPENSEARCH_SERVICE',
        'ATHENA',
        'CLOUDWATCH',
        'PROMETHEUS',
        'XRAY',
      ],
    });
    const instructions = [];
    if (props.adminGroups && props.adminGroups.length > 0) {
      instructions.push({
        action: 'ADD',
        role: 'ADMIN',
        users: props.adminGroups.map(group => ({
          id: group,
          type: 'SSO_GROUP',
        })),
      });
    }
    if (props.editorGroups && props.editorGroups.length > 0) {
      instructions.push({
        action: 'ADD',
        role: 'EDITOR',
        users: props.editorGroups.map(group => ({
          id: group,
          type: 'SSO_GROUP',
        })),
      });
    }
    if (instructions.length > 0) {
      const call: AwsSdkCall = {
        service: 'Grafana',
        action: 'updatePermissions',
        parameters: {
          workspaceId: this.workspace.ref,
          updateInstructionBatch: instructions,
        },
        region: Stack.of(this).region,
        physicalResourceId: {
          id: crypto
            .createHash('sha256')
            .update(JSON.stringify(instructions))
            .digest('hex'),
        },
      };
      new AwsCustomResource(this, 'UpdatePermissions', {
        installLatestAwsSdk: true,
        onUpdate: call,
        policy: {
          statements: [
            new PolicyStatement({
              resources: ['*'],
              actions: [
                'sso:Get*',
                'sso:List*',
                'sso:Describe*',
                'sso:AssociateProfile',
                'grafana:DescribeWorkspace',
                'grafana:UpdatePermissions',
              ],
              effect: Effect.ALLOW,
            }),
          ],
        },
      });
    }
  }

  /**
   * Adds a policy statement to the role used by Grafana.
   *
   * @param statement the statement to add
   */
  addToRolePolicy(statement: PolicyStatement) {
    this.role.addToPolicy(statement);
  }

  /**
   * Adds a policy statement to the role used by Grafana allowing it to assume another role.
   *
   * @param role the role to allow grafana to assume
   */
  addAssumeRole(...role: string[]) {
    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: role,
      })
    );
  }
}
