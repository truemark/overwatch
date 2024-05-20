import {Role} from 'aws-cdk-lib/aws-iam';
import {ExtendedNodejsFunction} from 'truemark-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import * as path from 'path';
import {Architecture, Runtime} from 'aws-cdk-lib/aws-lambda';
import {Duration} from 'aws-cdk-lib';

export interface ConfigFunctionProps {
  readonly openSearchMasterRole: Role;
  readonly openSearchEndpoint: string;
}

export class ConfigFunction extends ExtendedNodejsFunction {
  constructor(scope: Construct, id: string, props: ConfigFunctionProps) {
    super(scope, id, {
      entry: path.join(
        __dirname,
        '..',
        '..',
        'handlers',
        'src',
        'config-handler.ts'
      ),
      architecture: Architecture.ARM_64,
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(300),
      memorySize: 768,
      deploymentOptions: {
        createDeployment: false,
      },
      environment: {
        OPEN_SEARCH_MASTER_ROLE_ARN: props.openSearchMasterRole.roleArn,
        OPEN_SEARCH_ENDPOINT: `https://${props.openSearchEndpoint}`,
      },
    });

    props.openSearchMasterRole.grantAssumeRole(this.grantPrincipal);
  }
}
