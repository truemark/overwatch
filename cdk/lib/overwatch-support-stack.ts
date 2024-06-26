import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {Construct} from 'constructs';
import {OverwatchSupportConstruct} from './overwatch-support-construct';
import {Vpc} from 'aws-cdk-lib/aws-ec2';
import {App} from 'aws-cdk-lib';
import {AccountAlarms} from './account-alarms';
import {
  AccountPrincipal,
  CompositePrincipal,
  Effect,
  PolicyStatement,
  Role,
} from 'aws-cdk-lib/aws-iam';

export interface OverwatchSupportStackProps extends ExtendedStackProps {
  readonly primaryRegion?: boolean;
  readonly vpcId: string;
  readonly availabilityZones: string[];
  readonly privateSubnetIds: string[];
  readonly trustedAccountList: string[];
}

export class OverwatchSupportStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: OverwatchSupportStackProps) {
    super(scope, id, props);

    if (props.primaryRegion ?? true) {
      new AccountAlarms(this, 'Alarms');

      const trustRelationships = new CompositePrincipal(
        ...props.trustedAccountList.map(
          accountId => new AccountPrincipal(accountId)
        )
      );
      const role = new Role(this, 'OverwatchObservability', {
        assumedBy: trustRelationships,
        description:
          'This role is used to allow grafana to access logs and metrics.',
      });
      const policies = [
        {
          sid: 'AllowReadingMetricsFromCloudWatch',
          actions: [
            'cloudwatch:ListMetrics',
            'cloudwatch:GetMetricStatistics',
            'cloudwatch:GetMetricData',
            'cloudwatch:DescribeAlarmsForMetric',
            'cloudwatch:DescribeAlarms',
            'cloudwatch:DescribeAlarmHistory',
          ],
          resources: ['*'],
        },
        {
          sid: 'AllowReadingLogsFromCloudWatch',
          actions: [
            'logs:StopQuery',
            'logs:StartQuery',
            'logs:GetQueryResults',
            'logs:GetLogGroupFields',
            'logs:GetLogEvents',
            'logs:DescribeLogGroups',
          ],
          resources: ['*'],
        },
        {
          sid: 'AllowReadingTagsInstancesRegionsFromEC2',
          actions: [
            'ec2:DescribeTags',
            'ec2:DescribeRegions',
            'ec2:DescribeInstances',
          ],
          resources: ['*'],
        },
        {
          sid: 'AllowReadingResourcesForTags',
          actions: ['tag:GetResources'],
          resources: ['*'],
        },
        {
          sid: 'AllowESGet',
          actions: [
            'es:ListDomainNames',
            'es:ESHttpGet',
            'es:DescribeElasticsearchDomains',
          ],
          resources: ['*'],
        },
        {
          sid: 'AllowESPost',
          actions: ['es:ESHttpPost'],
          resources: [
            'arn:aws:es:*:*:domain/*/_opendistro/_ppl',
            'arn:aws:es:*:*:domain/*/_msearch*',
          ],
        },
        {
          sid: 'AllowAMPReadOnly',
          actions: [
            'aps:QueryMetrics',
            'aps:ListWorkspaces',
            'aps:GetSeries',
            'aps:GetMetricMetadata',
            'aps:GetLabels',
            'aps:DescribeWorkspace',
          ],
          resources: ['*'],
        },
        {
          sid: 'AllowAthenaReadOnly',
          actions: [
            'athena:ListWorkGroups',
            'athena:ListTableMetadata',
            'athena:ListDatabases',
            'athena:ListDataCatalogs',
            'athena:GetTableMetadata',
            'athena:GetDatabase',
            'athena:GetDataCatalog',
          ],
          resources: ['*'],
        },
        {
          sid: 'AllowAthenaOperations',
          actions: [
            'athena:StopQueryExecution',
            'athena:StartQueryExecution',
            'athena:GetWorkGroup',
            'athena:GetQueryResults',
            'athena:GetQueryExecution',
          ],
          resources: ['*'],
        },
        {
          sid: 'AllowGlueReadOnly',
          actions: [
            'glue:GetTables',
            'glue:GetTable',
            'glue:GetPartitions',
            'glue:GetPartition',
            'glue:GetDatabases',
            'glue:GetDatabase',
            'glue:BatchGetPartition',
          ],
          resources: ['*'],
        },
        {
          sid: 'AllowReadingTracesFromXRay',
          actions: [
            'xray:GetTraceSummaries',
            'xray:GetTraceGraph',
            'xray:GetTimeSeriesServiceStatistics',
            'xray:GetServiceGraph',
            'xray:GetInsightSummaries',
            'xray:GetInsight',
            'xray:GetGroups',
            'xray:BatchGetTraces',
            'ec2:DescribeRegions',
          ],
          resources: ['*'],
        },
        {
          sid: 'AllowAOSSOperations',
          actions: [
            'aoss:BatchGetCollection',
            'aoss:ListLifecyclePolicies',
            'aoss:BatchGetLifecyclePolicy',
            'aoss:ListSecurityConfigs',
            'aoss:GetAccessPolicy',
            'aoss:ListAccessPolicies',
            'aoss:ListSecurityPolicies',
            'aoss:BatchGetVpcEndpoint',
            'aoss:GetPoliciesStats',
            'aoss:ListVpcEndpoints',
            'aoss:GetAccountSettings',
            'aoss:GetSecurityConfig',
            'aoss:BatchGetEffectiveLifecyclePolicy',
            'aoss:ListCollections',
            'aoss:GetSecurityPolicy',
            'aoss:ListTagsForResource',
            'aoss:APIAccessAll',
          ],
          resources: ['*'],
        },
      ];
      policies.forEach(policy => {
        role.addToPolicy(
          new PolicyStatement({
            sid: policy.sid,
            effect: Effect.ALLOW,
            actions: policy.actions,
            resources: policy.resources,
          })
        );
      });
    }

    const vpc = Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: props.availabilityZones,
      privateSubnetIds: props.privateSubnetIds,
    });
    new OverwatchSupportConstruct(this, 'Default', {
      vpc,
    });
  }

  static propsFromContext(app: App): OverwatchSupportStackProps {
    let primaryRegion = app.node.tryGetContext('primaryRegion');
    primaryRegion = primaryRegion === undefined || primaryRegion === 'true';
    const vpcId = app.node.tryGetContext('vpcId');
    if (!vpcId) {
      throw new Error('vpcId is required in context');
    }
    let availabilityZones = app.node.tryGetContext('availabilityZones');
    if (!availabilityZones) {
      throw new Error('availabilityZones is required in context');
    }
    availabilityZones = availabilityZones
      .split(',')
      .map((az: string) => az.trim());
    let privateSubnetIds = app.node.tryGetContext('privateSubnetIds');
    if (!privateSubnetIds) {
      throw new Error('privateSubnetIds is required in context');
    }
    privateSubnetIds = privateSubnetIds
      .split(',')
      .map((id: string) => id.trim());
    return {
      primaryRegion,
      vpcId,
      availabilityZones,
      privateSubnetIds,
      trustedAccountList,
    };
  }

  static fromContext(app: App, id: string): OverwatchSupportStack {
    return new OverwatchSupportStack(
      app,
      id,
      OverwatchSupportStack.propsFromContext(app)
    );
  }
}
