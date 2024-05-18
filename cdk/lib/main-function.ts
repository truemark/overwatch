import {ExtendedNodejsFunction} from 'truemark-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import * as path from 'path';
import {Duration} from 'aws-cdk-lib';
import {Architecture, Runtime} from 'aws-cdk-lib/aws-lambda';
import {Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';

export class MainFunction extends ExtendedNodejsFunction {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      entry: path.join(
        __dirname,
        '..',
        '..',
        'handlers',
        'src',
        'main-handler.ts'
      ),
      architecture: Architecture.ARM_64,
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(300),
      memorySize: 768,
    });

    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'logs:CreateLogDelivery',
          'logs:PutResourcePolicy',
          'osis:CreatePipeline',
          'osis:GetPipeline',
          'osis:ListPipelines',
          'osis:TagResource',
          'osis:ValidatePipeline',
          'sqs:CreateQueue',
          'sqs:GetQueueUrl',
          'sqs:SendMessage',
          'sqs:SetQueueAttributes',
          'sqs:TagQueue',
        ],
        resources: ['*'],
      })
    );
  }
}
