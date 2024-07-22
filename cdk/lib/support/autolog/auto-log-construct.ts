import {Construct} from 'constructs';
import {AutoLogTagFunction} from './auto-log-tag-function';
import {StandardQueue} from 'truemark-cdk-lib/aws-sqs';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';
import {Rule} from 'aws-cdk-lib/aws-events';
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {LogGroup, RetentionDays} from 'aws-cdk-lib/aws-logs';
import {RemovalPolicy} from 'aws-cdk-lib';
import {AutoLogIngestionFunction} from './auto-log-ingestion-function';

export class AutoLogConstruct extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Role used by firehose to write to S3
    const deliveryStreamRole = new Role(this, 'DeliveryStreamRole', {
      assumedBy: new ServicePrincipal('firehose.amazonaws.com'),
    });
    deliveryStreamRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:PutObject'],
        resources: ['*'],
      })
    );
    deliveryStreamRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: ['*'],
      })
    );

    const logIngestionFunction = new AutoLogIngestionFunction(
      this,
      'LogIngestionFunction',
      {}
    );

    // Role used by CloudWatch logs to write to firehose or lambda
    const subscriptionFilterRole = new Role(this, 'SubscriptionFilterRole', {
      assumedBy: new ServicePrincipal('logs.amazonaws.com'),
    });
    subscriptionFilterRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
        resources: [
          'arn:aws:firehose:us-west-2:*:deliverystream/AutoLog*',
          'arn:aws:firehose:us-west-2:*:deliverystream/Overwatch*',
        ],
      })
    );
    subscriptionFilterRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [logIngestionFunction.functionArn],
      })
    );

    const deliveryStreamLogGroup = new LogGroup(
      this,
      'DeliveryStreamLogGroup',
      {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    const mainFunction = new AutoLogTagFunction(this, 'MainFunction', {
      deliveryStreamRole,
      deliveryStreamLogGroupName: deliveryStreamLogGroup.logGroupName,
      subscriptionFilterRole,
    });
    const deadLetterQueue = new StandardQueue(this, 'DeadLetterQueue'); // TODO Add alerting around this
    const mainTarget = new LambdaFunction(mainFunction, {
      deadLetterQueue,
    });

    const tagRule = new Rule(this, 'TagRule', {
      eventPattern: {
        source: ['aws.tag'],
        detailType: ['Tag Change on Resource'],
        detail: {
          service: ['logs'],
          'resource-type': ['log-group'],
          'changed-tag-keys': ['autolog:dest'],
        },
      },
      description: 'Routes tag events to AutoLog',
    });
    tagRule.addTarget(mainTarget);

    const logGroupRule = new Rule(this, 'LogGroupRule', {
      eventPattern: {
        source: ['aws.logs'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventSource: ['logs.amazonaws.com'],
          eventName: ['CreateLogGroup', 'DeleteLogGroup'],
        },
      },
      description: 'Routes log group events to AutoLog',
    });
    logGroupRule.addTarget(mainTarget);
  }
}
