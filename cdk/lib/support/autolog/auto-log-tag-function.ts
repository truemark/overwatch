import {ExtendedNodejsFunction} from 'truemark-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import * as path from 'path';
import {Duration} from 'aws-cdk-lib';
import {Architecture} from 'aws-cdk-lib/aws-lambda';
import {Effect, PolicyStatement, Role} from 'aws-cdk-lib/aws-iam';
import {Rule} from 'aws-cdk-lib/aws-events';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';
import {StandardQueue} from 'truemark-cdk-lib/aws-sqs';

export interface AutoLogTagFunctionProps {
  readonly deliveryStreamRole: Role;
  readonly deliveryStreamLogGroupName: string;
  readonly subscriptionFilterRole: Role;
  // readonly failedLogsBucket: Bucket;
}

export class AutoLogTagFunction extends ExtendedNodejsFunction {
  constructor(scope: Construct, id: string, props: AutoLogTagFunctionProps) {
    super(scope, id, {
      entry: path.join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'handlers',
        'src',
        'support',
        'autolog',
        'log-tag-handler.ts'
      ),
      architecture: Architecture.ARM_64,
      handler: 'handler',
      timeout: Duration.seconds(300),
      deploymentOptions: {
        createDeployment: false,
      },
      memorySize: 512,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        DELIVERY_STREAM_ROLE_ARN: props.deliveryStreamRole.roleArn,
        DELIVERY_STREAM_LOG_GROUP_NAME: props.deliveryStreamLogGroupName,
        SUBSCRIPTION_FILTER_ROLE_ARN: props.subscriptionFilterRole.roleArn,
        // FIREHOSE_ARN:
        //   'arn:aws:firehose:us-west-2:381492266277:deliverystream/test',
        // FIREHOSE_ROLE_ARN: props.firehoseRole.roleArn,
        // FAILED_LOGS_BUCKET_ARN: props.failedLogsBucket.bucketArn,
      },
    });
    // TODO Adjust this to be more specific
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'logs:ListTagsForResource',
          'logs:PutSubscriptionFilter',
          'logs:DeleteSubscriptionFilter',
          'logs:DescribeSubscriptionFilters',
          'logs:CreateLogStream',
          'iam:PassRole',
          'firehose:CreateDeliveryStream',
          'firehose:DeleteDeliveryStream',
          'firehose:DescribeDeliveryStream',
        ],
        resources: ['*'],
        effect: Effect.ALLOW,
      })
    );

    const deadLetterQueue = new StandardQueue(this, 'Dlq'); // TODO Add alerting around this

    const target = new LambdaFunction(this, {
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
    tagRule.addTarget(target);

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
    logGroupRule.addTarget(target);
  }
}
