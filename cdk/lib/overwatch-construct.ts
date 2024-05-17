import {Construct} from 'constructs';
import {
  AccountPrincipal,
  AnyPrincipal,
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {CfnOutput, RemovalPolicy, Stack} from 'aws-cdk-lib';
import {Bucket, BucketEncryption} from 'aws-cdk-lib/aws-s3';
import {MainFunction} from './main-function';
import {Rule} from 'aws-cdk-lib/aws-events';
import {StandardQueue} from 'truemark-cdk-lib/aws-sqs';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';
import {ReadWriteType, Trail} from 'aws-cdk-lib/aws-cloudtrail';
import {HostedDomainNameProps, StandardDomain} from './standard-domain';

export interface OverwatchProps {
  readonly volumeSize?: number;
  readonly masterUserArn: string;
  readonly idpEntityId: string;
  readonly idpMetadataContent: string;
  readonly masterBackendRole: string;
  readonly hostedDomainName?: HostedDomainNameProps;
  readonly accountIds: string[];
}

export class Overwatch extends Construct {
  constructor(scope: Construct, id: string, props: OverwatchProps) {
    super(scope, id);

    // TODO Add AWS Managed Grafana

    // Lambda function to process the log event
    const mainFunction = new MainFunction(this, 'MainFunction');

    const deadLetterQueue = new StandardQueue(this, 'DeadLetterQueue'); // TODO Add alerting around this
    const mainTarget = new LambdaFunction(mainFunction, {
      deadLetterQueue,
    });

    // S3 Bucket for log events storage
    const logsBucket = this.createLogsBucket(mainTarget, props.accountIds);

    // Create and configure CloudTrail for s3 logs events
    this.setupCloudTrail(logsBucket);

    // Create OpenSearch Domain
    const domain = new StandardDomain(this, 'Domain', {
      domainName: 'logs',
      masterUserArn: props.masterUserArn,
      idpEntityId: props.idpEntityId,
      idpMetadataContent: props.idpMetadataContent,
      masterBackendRole: props.masterBackendRole,
      volumeSize: props.volumeSize,
      // writeAccess: [new AccountRootPrincipal()], // TODO This didn't work.
      writeAccess: [new AnyPrincipal()], // TODO What can we set this to for more security?
      hostedDomainName: props.hostedDomainName,
    });

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

  private createLogsBucket(
    mainTarget: LambdaFunction,
    accountIds: string[]
  ): Bucket {
    const logsBucket = new Bucket(this, 'Logs', {
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
        'logs:PutResourcePolicy',
      ],
      resources: ['*'], // TODO This should be more restrictive
    });
    mainFunction.addToRolePolicy(osisPolicy);

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

  private createElasticsearchRole(domainArn: string, bucketArn: string): Role {
    const role = new Role(this, 'AccessRole', {
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
    const bucket = new Bucket(this, 'CloudTrailBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    bucket.grantReadWrite(new ServicePrincipal('cloudtrail.amazonaws.com'));
    const trail = new Trail(this, 'S3LogsTrail', {
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      sendToCloudWatchLogs: false,
      bucket,
    });

    // Add S3 data event Selector for the logs bucket
    trail.addS3EventSelector([{bucket: logsBucket}], {
      includeManagementEvents: false,
      readWriteType: ReadWriteType.WRITE_ONLY,
    });
  }
}
