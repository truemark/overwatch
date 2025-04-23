import {Construct} from 'constructs';
import {
  AccountPrincipal,
  AccountRootPrincipal,
  AnyPrincipal,
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
  User,
} from 'aws-cdk-lib/aws-iam';
import {CfnOutput, Stack} from 'aws-cdk-lib';
import {Bucket, BucketEncryption} from 'aws-cdk-lib/aws-s3';
import {MainFunction} from './main-function';
import {Rule} from 'aws-cdk-lib/aws-events';
import {StandardQueue} from 'truemark-cdk-lib/aws-sqs';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';
import {HostedDomainNameProps, StandardDomain} from './standard-domain';
import {ResourcePolicy} from 'aws-cdk-lib/aws-logs';
import {ConfigFunction} from './config-function';
import {StandardWorkspace} from './standard-workspace';
import {EngineVersion} from 'aws-cdk-lib/aws-opensearchservice';
import {CfnDeliveryStream} from 'aws-cdk-lib/aws-kinesisfirehose';
export interface LogsConfig {
  readonly volumeSize?: number;
  readonly idpEntityId: string;
  readonly idpMetadataContent: string;
  readonly masterBackendRole: string;
  readonly hostedDomainName?: HostedDomainNameProps;
  readonly accountIds: string[];
  readonly dataNodeInstanceType: string;
  readonly devRoleBackendIds: string;
}

export interface GrafanaConfig {
  readonly organizationalUnits: string[];
  readonly adminGroups?: string[];
  readonly editorGroups?: string[];
  readonly vpcConfiguration?: {
    readonly subnetIds: string[];
    readonly securityGroupIds: string[];
  };
}

export interface OverwatchProps {
  readonly logsConfig?: LogsConfig;
  readonly grafanaConfig?: GrafanaConfig;
}

export class Overwatch extends Construct {
  constructor(scope: Construct, id: string, props: OverwatchProps) {
    super(scope, id);

    // Grafana Setup
    if (props.grafanaConfig) {
      this.grafanaSetup(props.grafanaConfig);
    }

    // OpenSearch Setup
    if (props.logsConfig) {
      this.logsSetup(props.logsConfig);
    }
  }

  private logsSetup(logsConfig: LogsConfig): void {
    const openSearchMasterRole = new Role(this, 'MasterRole', {
      assumedBy: new AccountRootPrincipal(), // TODO Be more restrictive
    });
    new ResourcePolicy(this, 'ResourcePolicy', {
      policyStatements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          principals: [new ServicePrincipal('delivery.logs.amazonaws.com')],
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['*'],
          // TODO Need to restrict to the log group pattern in the region and account
          // conditions: {
          //   ArnLike: {
          //     'aws:SourceArn': `arn:aws:logs:${Stack.of(this).region}:${
          //       Stack.of(this).account
          //     }:log-group:/aws/vendedlogs/*`,
          //   },
          // },
        }),
      ],
    });
    // Lambda function to process the log event
    const mainFunction = new MainFunction(this, 'MainFunction', {
      openSearchMasterRole,
    });
    const deadLetterQueue = new StandardQueue(this, 'DeadLetterQueue'); // TODO Add alerting around this
    const mainTarget = new LambdaFunction(mainFunction, {
      deadLetterQueue,
    });

    // S3 Bucket for log events storage
    const logsBucket = this.createLogsBucket(mainTarget, logsConfig.accountIds);

    //Add Kinesis Firehose for logs
    this.setupKinesisFirehose(logsBucket);

    // Setup EventBridge for S3 logs events
    this.setupEventBridge(logsBucket, mainTarget);

    // Create OpenSearch Domain
    const domain = new StandardDomain(this, 'Domain', {
      engineVersion: EngineVersion.OPENSEARCH_2_13,
      domainName: 'logs',
      masterUserArn: openSearchMasterRole.roleArn,
      idpEntityId: logsConfig.idpEntityId,
      idpMetadataContent: logsConfig.idpMetadataContent,
      masterBackendRole: logsConfig.masterBackendRole,
      volumeSize: logsConfig.volumeSize,
      // writeAccess: [new AccountRootPrincipal()], // TODO This didn't work.
      writeAccess: [new AnyPrincipal()], // TODO What can we set this to for more security?
      hostedDomainName: logsConfig.hostedDomainName,
      dataNodeInstanceType: logsConfig.dataNodeInstanceType,
      dataNodes: 4,
      iops: 7500,
      throughput: 250,
      maxClauseCount: '4096',
      fieldDataCacheSize: '40',
    });
    // Attach the necessary permissions for ISM actions
    openSearchMasterRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['es:*'],
        resources: [domain.domainArn],
      })
    );

    // Create an IAM Role with attached policies
    const osAccessRole = this.createOpenSearchAccessRole(
      domain.domainArn,
      logsBucket.bucketArn
    );
    osAccessRole.node.addDependency(domain);
    osAccessRole.node.addDependency(logsBucket);

    //Attach policies to the Lambda function
    this.attachPolicies(mainFunction, osAccessRole.roleArn);
    mainFunction.node.addDependency(osAccessRole);

    //Add Lambda environment variables
    mainFunction.addEnvironment(
      'OPEN_SEARCH_ENDPOINT',
      `https://${domain.domainEndpoint}`
    );
    mainFunction.addEnvironment('OSIS_ROLE_ARN', osAccessRole.roleArn);
    const configFunction = new ConfigFunction(this, 'ConfigFunction', {
      openSearchMasterRole: openSearchMasterRole,
      openSearchEndpoint: domain.domainEndpoint,
      openSearchAccessRole: osAccessRole,
    });
    configFunction.addEnvironment(
      'DEVELOPER_ROLE_BACKEND_GROUPS',
      logsConfig.devRoleBackendIds
    );
  }

  private grafanaSetup(grafanaConfig: GrafanaConfig): void {
    const workspace = new StandardWorkspace(this, 'Grafana', {
      name: 'Overwatch',
      organizationalUnits: grafanaConfig.organizationalUnits,
      adminGroups: grafanaConfig.adminGroups,
      editorGroups: grafanaConfig.editorGroups,
      vpcConfiguration: grafanaConfig.vpcConfiguration,
      // Disabled temporarily until the plugin works better
      // dataSources:
      // [
      //   'AMAZON_OPENSEARCH_SERVICE',
      //   'ATHENA',
      //   'CLOUDWATCH',
      //   'PROMETHEUS',
      //   'XRAY',
      // ],
    });
    workspace.addAssumeRole('arn:aws:iam::*:role/OverwatchObservability');
  }

  private createLogsBucket(
    mainTarget: LambdaFunction,
    accountIds: string[]
  ): Bucket {
    const logsBucket = new Bucket(this, 'Logs', {
      eventBridgeEnabled: true,
      encryption: BucketEncryption.S3_MANAGED,
      bucketName: Stack.of(this).account + '-logs',
    });
    logsBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        principals: accountIds.map(
          accountId => new AccountPrincipal(accountId)
        ),
        resources: [logsBucket.arnForObjects('*')], // TODO This should be more restrictive
        effect: Effect.ALLOW,
        conditions: {},
      })
    );

    new CfnOutput(this, 'LogsBucketArn', {
      value: logsBucket.bucketArn,
    });
    return logsBucket;
  }

  private attachPolicies(mainFunction: MainFunction, esRoleArn: string): void {
    // TODO Move to MainFunction
    const osisLogsPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['logs:CreateLogDelivery'],
      resources: ['*'], // TODO This should be more restrictive
    });
    mainFunction.addToRolePolicy(osisLogsPolicy);

    // Permission to create service linked roles for OpenSearch
    const serviceLinkedRolePolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iam:CreateServiceLinkedRole'],
      resources: [
        'arn:aws:iam::*:role/aws-service-role/osis.amazonaws.com/AWSServiceRoleForAmazonOpenSearchIngestionService',
      ],
      conditions: {
        StringLike: {
          'iam:AWSServiceName': 'osis.amazonaws.com',
        },
      },
    });
    mainFunction.addToRolePolicy(serviceLinkedRolePolicy);

    const osisIamPassPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [esRoleArn],
    });
    mainFunction.addToRolePolicy(osisIamPassPolicy);
  }

  private createOpenSearchAccessRole(
    domainArn: string,
    bucketArn: string
  ): Role {
    const role = new Role(this, 'AccessRole', {
      assumedBy: new ServicePrincipal('osis-pipelines.amazonaws.com'),
      description: 'Role to allow Elasticsearch domain operations',
    });

    // Define a list of policy statements
    const policyStatements = [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['es:DescribeDomain'],
        resources: [`arn:aws:es:*:${Stack.of(this).account}:domain/*`],
      }),
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['es:ESHttp*', 'es:DescribeDomain'],
        resources: [`${domainArn}/*`],
      }),
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'sqs:ChangeMessageVisibility',
          'sqs:DeleteMessage',
          'sqs:ReceiveMessage',
          's3:GetObject',
          's3:ListBucket',
          's3:DeleteObject',
          's3:GetBucketLocation',
          's3:ListAllMyBuckets',
        ],
        resources: ['*'],
      }),
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:ListBucket',
          's3:DeleteObject',
          's3:PutObject',
        ],
        resources: [bucketArn, `${bucketArn}/*`],
      }),
    ];

    // Attach each policy statement to the role
    policyStatements.forEach(policy => role.addToPolicy(policy));

    return role;
  }

  private setupEventBridge(
    logsBucket: Bucket,
    mainTarget: LambdaFunction
  ): void {
    const logsBucketRule = new Rule(this, 'LogsBucketRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [logsBucket.bucketName],
          },
        },
      },
      description: 'Routes S3 events to Overwatch',
    });
    logsBucketRule.addTarget(mainTarget);
  }

  private async setupKinesisFirehose(logsBucket: Bucket): Promise<void> {
    // Create IAM Role for Firehose to access S3
    const firehoseRole = new Role(this, 'FirehoseRole', {
      assumedBy: new ServicePrincipal('firehose.amazonaws.com'),
    });

    // Grant Firehose access to S3 bucket
    firehoseRole.addToPolicy(
      new PolicyStatement({
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        resources: [logsBucket.bucketArn, `${logsBucket.bucketArn}/*`],
        effect: Effect.ALLOW,
      })
    );

    // Firehose Extended S3 Destination Configuration for Prod
    const prodExtendedS3DestinationConfig = {
      roleArn: firehoseRole.roleArn,
      bucketArn: logsBucket.bucketArn,
      deliveryStreamType: 'DirectPut',
      prefix: `autolog/prod/${Stack.of(this).account}/${Stack.of(this).region}/`,
      bufferingHints: {
        sizeInMBs: 128,
        intervalInSeconds: 60,
      },
      compressionFormat: 'GZIP',
      cloudWatchLoggingOptions: {
        enabled: true,
        logGroupName: '/aws/kinesisfirehose/prod-logs',
        logStreamName: 'prod-logs',
      },
      s3BackupMode: 'Disabled',
    };

    // Create Kinesis Firehose Delivery Stream for Prod
    const prodLogsFirehose = new CfnDeliveryStream(this, 'ProdFirehose', {
      deliveryStreamName: 'prod-os-logs',
      extendedS3DestinationConfiguration: prodExtendedS3DestinationConfig,
    });

    // Firehose Extended S3 Destination Configuration for Non-Production
    const nonProdExtendedS3DestinationConfig = {
      ...prodExtendedS3DestinationConfig,
      prefix: `autolog/non-prod/${Stack.of(this).account}/${Stack.of(this).region}/`,
      cloudWatchLoggingOptions: {
        enabled: true,
        logGroupName: '/aws/kinesisfirehose/non-prod-logs',
        logStreamName: 'non-prod-logs',
      },
    };

    // Create Kinesis Firehose Delivery Stream for Non-Prod
    const nonprodLogsFirehose = new CfnDeliveryStream(this, 'NonProdFirehose', {
      deliveryStreamName: 'non-prod-os-logs',
      extendedS3DestinationConfiguration: nonProdExtendedS3DestinationConfig,
    });

    // Firehose Extended S3 Destination Configuration for Syslog
    const syslogExtendedS3DestinationConfig = {
      ...prodExtendedS3DestinationConfig,
      prefix: `autolog/syslog/${Stack.of(this).account}/${Stack.of(this).region}/`,
      cloudWatchLoggingOptions: {
        enabled: true,
        logGroupName: '/aws/kinesisfirehose/syslog-logs',
        logStreamName: 'syslog-logs',
      },
    };

    // Create Kinesis Firehose Delivery Stream for Syslog
    const syslogFirehose = new CfnDeliveryStream(this, 'SyslogFirehose', {
      deliveryStreamName: 'syslog-os-logs',
      extendedS3DestinationConfiguration: syslogExtendedS3DestinationConfig,
    });

    // Create IAM user with permissions to write to Firehose
    const firehoseLogsUser = new User(this, 'FirehoseLogsUser', {
      userName: 'oslogs',
    });

    firehoseLogsUser.addToPolicy(
      new PolicyStatement({
        actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
        resources: [
          prodLogsFirehose.attrArn,
          nonprodLogsFirehose.attrArn,
          syslogFirehose.attrArn,
        ],
      })
    );
  }
}
