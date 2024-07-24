import {Construct} from 'constructs';
import {CfnWorkspace} from 'aws-cdk-lib/aws-aps';
import {
  InstanceProfile,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {AlertsTopic} from 'truemark-cdk-lib/aws-centergauge';
import {InstallTagFunction} from './install/install-tag-function';
import * as path from 'path';
import * as fs from 'fs';
import * as process from 'process';
import {Stack} from 'aws-cdk-lib';

/**
 * Handles the creation of primary services used in Overwatch.
 */
export class OverwatchSupportConstruct extends Construct {
  readonly workspace: CfnWorkspace;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const alertsTopic = new AlertsTopic(this, 'AlertsTopic', {
      topicName: 'OverwatchAlerts',
      url: 'https://ingest.centergauge.com/',
    });

    this.workspace = new CfnWorkspace(this, 'Workspace', {
      alias: 'Overwatch',
      alertManagerDefinition: fs
        .readFileSync(
          path.join(
            __dirname,
            '..',
            '..',
            '..',
            'support',
            'alertmanager.yaml'
          ),
          'utf-8'
        )
        .replace(/{{{region}}}/g, Stack.of(this).region)
        .replace(/{{{alertsTopicArn}}}/g, alertsTopic.topic.topicArn),
    });

    const producerRole = new Role(this, 'OverwatchProducerRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      roleName: 'OverwatchProducer',
    });

    const producerPolicy = new ManagedPolicy(this, 'OverwatchProducerPolicy', {
      managedPolicyName: 'OverwatchProducer',
      statements: [
        new PolicyStatement({
          actions: ['aps:RemoteWrite'],
          resources: [this.workspace.attrArn],
        }),
        new PolicyStatement({
          actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
          resources: [
            'arn:aws:firehose:*:*:deliverystream/Overwatch*',
            'arn:aws:firehose:*:*:deliverystream/AutoLog*',
          ],
        }),
        new PolicyStatement({
          actions: ['ec2:DescribeInstances'],
          resources: ['*'],
        }),
      ],
    });
    producerPolicy.attachToRole(producerRole);
    producerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );
    producerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );

    new InstanceProfile(this, 'InstanceProfile', {
      role: producerRole,
      instanceProfileName: 'OverwatchProducer',
    });

    new InstallTagFunction(this, 'InstallTagFunction');
  }
}
