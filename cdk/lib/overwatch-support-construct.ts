import {Construct} from 'constructs';
import {StringParameter, CfnDocument} from 'aws-cdk-lib/aws-ssm';
import {IVpc, SecurityGroup, Port, Peer} from 'aws-cdk-lib/aws-ec2';
import {PrometheusScraper} from './prometheus-scraper';
import {Cluster} from 'aws-cdk-lib/aws-ecs';
import {CfnWorkspace} from 'aws-cdk-lib/aws-aps';
import * as fs from 'fs';
import * as path from 'path';

export interface OverwatchSupportConstructProps {
  readonly vpc: IVpc;
}

export class OverwatchSupportConstruct extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: OverwatchSupportConstructProps
  ) {
    super(scope, id);

    const prometheusWorkspace = new CfnWorkspace(this, 'Workspace', {
      alias: 'Overwatch',
    });

    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    const nodeExporterServiceConfig = fs.readFileSync(
      path.join(__dirname, '..', '..', 'support', 'node_exporter.service'),
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
                  'support',
                  'install_node_exporter.ps1'
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
                  'support',
                  'install_node_exporter.sh'
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

    // Create and overwatch ECS cluster
    const cluster = new Cluster(this, 'Overwatch', {
      vpc: props.vpc,
    });
    // Create Prometheus scraper
    const ecsPrometheus = new PrometheusScraper(this, 'PrometheusScraper', {
      cluster: cluster,
      workspace: prometheusWorkspace,
    });

    const securityGroup = new SecurityGroup(this, 'PrometheusSecurityGroup', {
      vpc: props.vpc,
      securityGroupName: 'prometheus-sg',
      description: 'Allow Prometheus scraping on port 9100 within the VPC',
      allowAllOutbound: true,
    });
    // Allow inbound traffic on port 9100 from within the VPC
    securityGroup.addIngressRule(
      Peer.securityGroupId(
        ecsPrometheus.fargatePrometheus.securityGroup.securityGroupId
      ),
      Port.tcp(9100),
      'Allow Prometheus scraping'
    );
  }
}
