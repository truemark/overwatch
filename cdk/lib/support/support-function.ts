import {ExtendedNodejsFunction} from 'truemark-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import * as path from 'path';
import {Duration} from 'aws-cdk-lib';
import {Architecture, Runtime} from 'aws-cdk-lib/aws-lambda';
import {Effect, PolicyStatement, Role} from 'aws-cdk-lib/aws-iam';

// export interface PrometheusFunctionProps {
//     readonly openSearchMasterRole: Role;
// }

// export class SupportFunction extends ExtendedNodejsFunction {
//   constructor(scope: Construct, id: string) {
//     super(scope, id, {
//       entry: path.join(
//         __dirname,
//         '..',
//         '..',
//         'handlers',
//         'src',
//         'support-handler.ts'
//       ),
//       architecture: Architecture.ARM_64,
//       handler: 'handler',
//       runtime: Runtime.NODEJS_20_X,
//       timeout: Duration.seconds(300),
//       memorySize: 768,
//       deploymentOptions: {
//         createDeployment: false,
//       },
//     });
//     //TODO update the policy statement to run ssm etc
//     this.addToRolePolicy(
//       new PolicyStatement({
//         effect: Effect.ALLOW,
//         actions: [
//           'ssm:SendCommand',
//           'ssm:ListCommands',
//           'ssm:ListCommandInvocations',
//           'ssm:GetCommandInvocation',
//           'ssm:DescribeInstanceInformation',
//           'ec2:DescribeInstances',
//           'logs:CreateLogGroup',
//           'logs:CreateLogStream',
//           'logs:PutLogEvents',
//         ],
//         resources: ['*'],
//       })
//     );
//
//     //props.openSearchMasterRole.grantAssumeRole(this.grantPrincipal);
//   }
// }
