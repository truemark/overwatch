import {Construct} from 'constructs';
import {Fn, Stack} from 'aws-cdk-lib';
import {StringParameter, CfnDocument} from 'aws-cdk-lib/aws-ssm';
import {CfnWorkspace} from 'aws-cdk-lib/aws-aps';
import * as fs from 'fs';
import * as path from 'path';
import {
  InstanceProfile,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';

export class OverwatchSupportConstruct extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const prometheusWorkspace = new CfnWorkspace(this, 'Workspace', {
      alias: 'Overwatch',
    });

    const overwatchProducerRole = new Role(this, 'OverwatchProducerRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      roleName: 'OverwatchProducer',
    });

    const overwatchProducerPolicy = new ManagedPolicy(
      this,
      'OverwatchProducerPolicy',
      {
        managedPolicyName: 'OverwatchProducer',
        statements: [
          new PolicyStatement({
            actions: ['aps:RemoteWrite'],
            resources: [prometheusWorkspace.attrArn],
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
      }
    );
    overwatchProducerPolicy.attachToRole(overwatchProducerRole);
    overwatchProducerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );
    overwatchProducerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );
    new InstanceProfile(this, 'InstanceProfile', {
      role: overwatchProducerRole,
      instanceProfileName: 'OverwatchProducer',
    });

    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    const nodeExporterServiceConfig = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'support',
        'node_exporter.service'
      ),
      'utf-8'
    );
    new StringParameter(this, 'NodeExporterServiceConfigParam', {
      parameterName: '/overwatch/prometheus-config/NodeExporter-ServiceConfig',
      stringValue: nodeExporterServiceConfig,
      description: 'The Node Exporter service configuration',
    });
    // Document for installing windows node exporter
    const documentContent = {
      schemaVersion: '2.2',
      description: 'Install Node Exporter',
      parameters: {
        NodeExporterPackageUrl: {
          default:
            'https://github.com/prometheus/node_exporter/releases/download/v1.8.1/node_exporter-1.8.1.linux-amd64.tar.gz',
          description: 'Node Exporter package URL',
          type: 'String',
        },
        NodeExporterPackageUrlArm: {
          default:
            'https://github.com/prometheus/node_exporter/releases/download/v1.8.1/node_exporter-1.8.1.linux-arm64.tar.gz',
          description: 'Node Exporter package URL',
          type: 'String',
        },
        WindowsExporterPackageUrl: {
          default:
            'https://github.com/prometheus-community/windows_exporter/releases/download/v0.25.1/windows_exporter-0.25.1-amd64.msi',
          description: 'Node Exporter package URL',
          type: 'String',
        },
        NodeExporterServiceConfig: {
          default:
            '{{ ssm:/overwatch/prometheus-config/NodeExporter-ServiceConfig }}',
          description: 'The Node Exporter service configuration',
          type: 'String',
        },
      },
      mainSteps: [
        {
          precondition: {
            StringEquals: ['platformType', 'Windows'],
          },
          action: 'aws:runPowerShellScript',
          name: 'InstallNodeExporterWindows',
          inputs: {
            runCommand: fs
              .readFileSync(
                path.join(
                  __dirname,
                  '..',
                  '..',
                  '..',
                  'support',
                  'node_exporter_install.ps1'
                ),
                'utf-8'
              )
              .split('\n'),
          },
        },
        {
          precondition: {
            StringEquals: ['platformType', 'Linux'],
          },
          action: 'aws:runShellScript',
          name: 'InstallNodeExporterLinux',
          inputs: {
            runCommand: fs
              .readFileSync(
                path.join(
                  __dirname,
                  '..',
                  '..',
                  '..',
                  'support',
                  'node_exporter_install.sh'
                ),
                'utf-8'
              )
              .split('\n'),
          },
        },
      ],
    };
    new CfnDocument(this, 'InstallNodeExporterDocument', {
      content: documentContent,
      documentType: 'Command',
      name: 'InstallNodeExporter',
      updateMethod: 'NewVersion',
    });
    const writeuri = prometheusWorkspace.attrPrometheusEndpoint;
    // split writeuri to get hostname and path
    const writeuriarray = Fn.split('/', writeuri);
    const workspaceId = Fn.select(4, writeuriarray);
    const prometheusDomain = Fn.parseDomainName(writeuri);
    const region = Stack.of(this).region;

    const fluentbitDocumentContent = {
      schemaVersion: '2.2',
      description: 'Install fluent-bit',
      parameters: {
        Windows64FluentbitPackageUrl: {
          default:
            'https://packages.fluentbit.io/windows/fluent-bit-3.1.3-win64.exe',
          description: 'Windows 64-bit Fluent-bit package URL',
          type: 'String',
        },
        PrometheusWorkspace: {
          default: workspaceId,
          description: 'Prometheus Remote Write URI',
          type: 'String',
        },
        PrometheusHostname: {
          default: prometheusDomain,
          description: 'Prometheus Remote Write URI',
          type: 'String',
        },
        Region: {
          default: region,
          description: 'Region',
          type: 'String',
        },
      },
      mainSteps: [
        {
          precondition: {
            StringEquals: ['platformType', 'Windows'],
          },
          action: 'aws:runPowerShellScript',
          name: 'WindowsFluentbitInstall',
          inputs: {
            runCommand: fs
              .readFileSync(
                path.join(
                  __dirname,
                  '..',
                  '..',
                  '..',
                  'support',
                  'fluent_bit_install.ps1'
                ),
                'utf-8'
              )
              .split('\n'),
          },
        },
        {
          precondition: {
            StringEquals: ['platformType', 'Linux'],
          },
          action: 'aws:runShellScript',
          name: 'LinuxFluentbitInstall',
          inputs: {
            runCommand: fs
              .readFileSync(
                path.join(
                  __dirname,
                  '..',
                  '..',
                  '..',
                  'support',
                  'fluent-bit-linux-install.sh'
                ),
                'utf-8'
              )
              .split('\n'),
          },
        },
      ],
    };
    new CfnDocument(this, 'InstallFluentbitDocument', {
      content: fluentbitDocumentContent,
      documentType: 'Command',
      name: 'InstallFluentbit',
      updateMethod: 'NewVersion',
    });
  }
}
