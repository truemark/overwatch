import {Construct} from 'constructs';
import {CfnWorkspace} from 'aws-cdk-lib/aws-aps';
import {CfnDocument, StringParameter} from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import * as fs from 'fs';
import {Fn, Stack} from 'aws-cdk-lib';

export interface InstallConstructProps {
  readonly workspace: CfnWorkspace;
}

/**
 * Handles package installation for EC2 instances.
 */
export class InstallConstruct extends Construct {
  constructor(scope: Construct, id: string, props: InstallConstructProps) {
    super(scope, id);

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
    const writeuri = props.workspace.attrPrometheusEndpoint;
    // split writeuri to get hostname and path
    const writeuriarray = Fn.split('/', writeuri);
    const workspaceId = Fn.select(4, writeuriarray);
    const prometheusDomain = Fn.parseDomainName(writeuri);
    const region = Stack.of(this).region;

    const fluentBitDocumentContent = {
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
          name: 'WindowsFluentBitInstall',
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
          name: 'LinuxFluentBitInstall',
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
    new CfnDocument(this, 'InstallFluentBitDocument', {
      content: fluentBitDocumentContent,
      documentType: 'Command',
      name: 'InstallFluentBit',
      updateMethod: 'NewVersion',
    });
  }
}
