import {ExtendedNodejsFunction} from 'truemark-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import * as path from 'path';
import {Architecture} from 'aws-cdk-lib/aws-lambda';
import {Duration} from 'aws-cdk-lib';
import {StandardQueue} from 'truemark-cdk-lib/aws-sqs';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';
import {Rule} from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';

export class InstallTagFunction extends ExtendedNodejsFunction {
  constructor(scope: Construct, id: string) {
    const role = new iam.Role(scope, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: ['*'],
      })
    );

    role.addManagedPolicy({
      managedPolicyArn:
        'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    });

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
        'install',
        'install-tag-handler.mts'
      ),
      architecture: Architecture.ARM_64,
      handler: 'handler',
      role: role,
      timeout: Duration.minutes(10),
      deploymentOptions: {
        createDeployment: false,
      },
      memorySize: 512,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    const deadLetterQueue = new StandardQueue(this, 'InstallDlq'); // TODO Add alerting around this

    const target = new LambdaFunction(this, {
      deadLetterQueue,
    });

    const tagRule = new Rule(this, 'TagRule', {
      eventPattern: {
        source: ['aws.tag'],
        detailType: ['Tag Change on Resource'],
        detail: {
          service: ['ec2'],
          'resource-type': ['instance'],
          'changed-tag-keys': ['overwatch:install'],
        },
      },
      description: 'Routes tag events to the Overwatch Install Tag Function',
    });
    tagRule.addTarget(target);
  }
}

// grab intance id from event, trigger ssm documents, use handler to run commands
// on the instance
