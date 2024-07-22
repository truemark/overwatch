import {ExtendedNodejsFunction} from 'truemark-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import * as path from 'path';
import {Architecture, Runtime} from 'aws-cdk-lib/aws-lambda';
import {Duration, Stack} from 'aws-cdk-lib';
import {Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';

export interface AutoLogIngestionFunctionProps {
  readonly logLevel?: string;
}

export class AutoLogIngestionFunction extends ExtendedNodejsFunction {
  constructor(
    scope: Construct,
    id: string,
    props: AutoLogIngestionFunctionProps
  ) {
    super(scope, id, {
      entry: path.join(
        __dirname,
        '..',
        '..',
        'handlers',
        'src',
        'support',
        'log-ingestion-handler.ts'
      ),
      architecture: Architecture.ARM_64,
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      deploymentOptions: {
        createDeployment: false,
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        LOG_LEVEL: props.logLevel ?? 'trace',
      },
    });
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
        resources: [
          `arn:aws:firehose:us-west-2:${Stack.of(this).account}:deliverystream/AutoLog*`,
          `arn:aws:firehose:us-west-2:${Stack.of(this).account}:deliverystream/Overwatch*`,
        ],
      })
    );
  }
}
