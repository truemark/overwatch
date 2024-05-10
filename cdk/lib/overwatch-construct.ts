import {Construct} from 'constructs';
import {Domain, EngineVersion} from 'aws-cdk-lib/aws-opensearchservice';
import {
  AccountPrincipal,
  AnyPrincipal,
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {EbsDeviceVolumeType} from 'aws-cdk-lib/aws-ec2';
import {CfnOutput, RemovalPolicy} from 'aws-cdk-lib';
import {Bucket, BucketEncryption} from 'aws-cdk-lib/aws-s3';
import {MainFunction} from './main-function';
import {Rule} from 'aws-cdk-lib/aws-events';
import {StandardQueue} from 'truemark-cdk-lib/aws-sqs';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';
import {Trail, ReadWriteType} from 'aws-cdk-lib/aws-cloudtrail';
import {SecretValue} from 'aws-cdk-lib/core';

export class OverwatchConstruct extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // TODO Add AWS Managed Grafana

    // Lambda function to process the log event
    const mainFunction = new MainFunction(this, 'MainFunction');

    const deadLetterQueue = new StandardQueue(this, 'DeadLetterQueue'); // TODO Add alerting around this
    const mainTarget = new LambdaFunction(mainFunction, {
      deadLetterQueue,
    });

    // S3 Bucket for log events storage
    const logsBucket = this.createLogsBucket(mainTarget);

    // Create and configure CloudTrail for s3 logs events
    this.setupCloudTrail(logsBucket);

    // Create OpenSearch Domain
    const domain = this.createOpenSearchDomain();

    // Create an IAM Role with attached policies
    const esRole = this.createElasticsearchRole(
      domain.domainArn,
      logsBucket.bucketArn
    );

    esRole.node.addDependency(domain);
    esRole.node.addDependency(logsBucket);

    //Attach policies to the Lambda function
    this.attachPolicies(mainFunction, esRole.roleArn);
    mainFunction.node.addDependency(esRole);

    //Add Lambda environment variables
    mainFunction.addEnvironment(
      'OS_ENDPOINT',
      `https://${domain.domainEndpoint}`
    );
    mainFunction.addEnvironment('OSIS_ROLE_ARN', esRole.roleArn);
    mainFunction.addEnvironment(
      'OS_REGION',
      process.env.CDK_DEFAULT_REGION || ''
    );
  }

  private createLogsBucket(mainTarget: LambdaFunction): Bucket {
    const logsBucket = new Bucket(this, 'Logs', {
      encryption: BucketEncryption.S3_MANAGED,
    });
    logsBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        principals: [
          new AccountPrincipal('062758075735'), //VO Dev
          new AccountPrincipal('348901320172'), //VO Prod
        ], // TODO Parameter
        resources: [logsBucket.arnForObjects('*')],
      })
    );

    const logsBucketRule = new Rule(this, 'LogsBucketRole', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventName: ['PutObject'],
          requestParameters: {
            bucketName: [logsBucket.bucketName],
          },
        },
      },
      description: 'Routes S3 events to Overwatch',
    });
    logsBucketRule.addTarget(mainTarget);
    new CfnOutput(this, 'LogsBucketArn', {
      value: logsBucket.bucketArn,
    });
    return logsBucket;
  }

  private attachPolicies(mainFunction: MainFunction, esRoleArn: string): void {
    const osisPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'osis:CreatePipeline',
        'osis:ListPipelines',
        'osis:GetPipeline',
        'osis:ValidatePipeline',
        'osis:TagResource',
        'sqs:CreateQueue',
        'sqs:SetQueueAttributes',
        'sqs:GetQueueUrl',
        'sqs:SendMessage',
        'iam:CreatePolicy',
      ],
      resources: ['*'],
    });
    mainFunction.addToRolePolicy(osisPolicy);

    const osisLogsPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['logs:CreateLogDelivery'],
      resources: ['*'],
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

  private createElasticsearchRole(domainArn: string, bucketArn: string): Role {
    const role = new Role(this, 'ElasticsrchAccessRole', {
      assumedBy: new ServicePrincipal('osis-pipelines.amazonaws.com'),
      description: 'Role to allow Elasticsearch domain operations',
    });

    // Define a list of policy statements
    const policyStatements = [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['es:DescribeDomain'],
        resources: [`arn:aws:es:*:${process.env.CDK_DEFAULT_ACCOUNT}:domain/*`],
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
        actions: ['s3:GetObject', 's3:ListBucket', 's3:DeleteObject'],
        resources: [bucketArn, `${bucketArn}/*`],
      }),
    ];

    // Attach each policy statement to the role
    policyStatements.forEach(policy => role.addToPolicy(policy));

    return role;
  }

  private setupCloudTrail(logsBucket: Bucket): void {
    const trail = new Trail(this, 'S3LogsTrail', {
      trailName: 's3-logs-trail',
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      sendToCloudWatchLogs: false,
    });

    // Add S3 data event Selector for the logs bucket
    trail.addS3EventSelector([{bucket: logsBucket}], {
      includeManagementEvents: false,
      readWriteType: ReadWriteType.WRITE_ONLY,
    });
  }

  private createOpenSearchDomain(): Domain {
    const masterUserPassword = SecretValue.unsafePlainText('Logs@admin1'); //TODO Change to be removed for SAML

    // Create OpenSearch Domain
    const domain = new Domain(this, 'LogsOpenSearchDomain', {
      version: EngineVersion.OPENSEARCH_2_11,
      removalPolicy: RemovalPolicy.DESTROY, //TODO Change to RETAIN in Prod?
      domainName: 'os-logs-domain',
      enableAutoSoftwareUpdate: true,
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: 'm5.large.search',
        // masterNodes: 2,
        // masterNodeInstanceType: 'm5.large.search',
        // warmNodes: 2,
        // warmInstanceType: 'ultrawarm1.medium.search',
        multiAzWithStandbyEnabled: false,
      },
      // zoneAwareness: {
      //   enabled: true,
      //   availabilityZoneCount: 2,
      // },
      ebs: {
        volumeSize: 10, // GiB
        volumeType: EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
      },
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true,
        auditLogEnabled: true,
      },
      encryptionAtRest: {
        enabled: true,
      },
      nodeToNodeEncryption: true,
      enforceHttps: true,
      useUnsignedBasicAuth: false,
      enableVersionUpgrade: true,
      fineGrainedAccessControl: {
        masterUserName: 'logsadmin',
        masterUserPassword: masterUserPassword,
      },
    });

    // Create an IAM Role for OpenSearch Ingestion
    const ingestionRole = new Role(this, 'OpenSearchIngestionRole', {
      assumedBy: new ServicePrincipal('osis.amazonaws.com'),
      description: 'Role for OpenSearch Ingestion',
    });

    // Attach policy to the role to allow writing to OpenSearch
    ingestionRole.addToPolicy(
      new PolicyStatement({
        actions: ['es:ESHttpPost', 'es:ESHttpPut'],
        resources: [domain.domainArn, `${domain.domainArn}/*`],
      })
    );

    // TODO Currently allows all things to write to this
    domain.addAccessPolicies(
      new PolicyStatement({
        actions: [
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpGet',
          'es:ESHttpDelete',
        ],
        effect: Effect.ALLOW,
        principals: [new AnyPrincipal(), ingestionRole],
        resources: [domain.domainArn, `${domain.domainArn}/*`],
      })
    );

    return domain;
  }
}
