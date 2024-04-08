import {Construct} from 'constructs';
import {Domain, EngineVersion} from 'aws-cdk-lib/aws-opensearchservice';
import {
  AccountPrincipal,
  AnyPrincipal,
  Effect,
  PolicyStatement,
} from 'aws-cdk-lib/aws-iam';
import {EbsDeviceVolumeType} from 'aws-cdk-lib/aws-ec2';
import {CfnOutput, RemovalPolicy} from 'aws-cdk-lib';
import {Bucket, BucketEncryption} from 'aws-cdk-lib/aws-s3';
import {MainFunction} from './main-function';
import {Rule} from 'aws-cdk-lib/aws-events';
import {StandardQueue} from 'truemark-cdk-lib/aws-sqs';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';
import {Trail, ReadWriteType} from 'aws-cdk-lib/aws-cloudtrail';

export class OverwatchConstruct extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // TODO Add AWS Managed Grafana

    const logsBucket = new Bucket(this, 'Logs', {
      encryption: BucketEncryption.S3_MANAGED,
    });
    logsBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        principals: [new AccountPrincipal('889335235414')], // TODO Parameter
        resources: [logsBucket.arnForObjects('*')],
      })
    );

    new CfnOutput(this, 'LogsBucketArn', {
      value: logsBucket.bucketArn,
    });

    const mainFunction = new MainFunction(this, 'MainFunction');
    const deadLetterQueue = new StandardQueue(this, 'DeadLetterQueue'); // TODO Add alerting around this
    const mainTarget = new LambdaFunction(mainFunction, {
      deadLetterQueue,
    });

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

    // Creating a CloudTrail
    const s3LogsTrail = new Trail(this, 'S3LogsTrail', {
      trailName: 's3-logs-trail',
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      sendToCloudWatchLogs: false,
    });

    // Add S3 data event Selector for the logs bucket
    s3LogsTrail.addS3EventSelector([{bucket: logsBucket}], {
      includeManagementEvents: false,
      readWriteType: ReadWriteType.WRITE_ONLY,
    });

    /* TODO Fouad Add OpenSearch Domain - See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_opensearchservice-readme.html
      Do not have this code create a service linked role. That will be done in another project.
      Ensure encryption is enabled
      Enable fine grained access control
      We want to do SAML authentication to AWS IAM Identity Center (can be added last)
      Add a custom access policy to allow data to be written from other accounts. You can harcode the accounts in here for now.
      Enable auditlogs
      Enable ultrawarm
      Enable software updates
      The Domain will be public
      Deploy into your dev account for now
    */

    // Create OpenSearch Domain
    const domain = new Domain(this, 'LogsOpenSearchDomain', {
      version: EngineVersion.OPENSEARCH_2_11,
      removalPolicy: RemovalPolicy.DESTROY,
      domainName: 'os-logs-domain',
      enableAutoSoftwareUpdate: true,
      capacity: {
        dataNodes: 3,
        dataNodeInstanceType: 'm5.large.search',
        masterNodes: 3,
        masterNodeInstanceType: 'm5.large.search',
        warmNodes: 3,
        warmInstanceType: 'ultrawarm1.medium.search',
      },
      zoneAwareness: {
        enabled: true,
        availabilityZoneCount: 3,
      },
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
      },
    });

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
        principals: [new AnyPrincipal()],
        resources: [domain.domainArn, `${domain.domainArn}/*`],
      })
    );
  }
}
