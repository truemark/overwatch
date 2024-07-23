import {ExtendedNodejsFunction} from 'truemark-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import * as path from 'path';
import {Architecture} from 'aws-cdk-lib/aws-lambda';
import {Duration} from 'aws-cdk-lib';
import {StandardQueue} from 'truemark-cdk-lib/aws-sqs';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';
import {Rule} from 'aws-cdk-lib/aws-events';

export class InstallTagFunction extends ExtendedNodejsFunction {
  constructor(scope: Construct, id: string) {
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
