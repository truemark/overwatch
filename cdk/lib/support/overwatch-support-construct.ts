import {Construct} from 'constructs';
import {StringParameter, CfnDocument} from 'aws-cdk-lib/aws-ssm';
import {IVpc, SecurityGroup, Port, Peer} from 'aws-cdk-lib/aws-ec2';
import {AlertsTopic} from 'truemark-cdk-lib/aws-centergauge';
import {PrometheusScraper} from './prometheus-scraper';
import {Cluster} from 'aws-cdk-lib/aws-ecs';
import {CfnWorkspace} from 'aws-cdk-lib/aws-aps';
import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';

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

    const alertsTopic = new AlertsTopic(this, 'AlertsTopic', {
      displayName: 'overwatch',
      url: 'https://ingest.centergauge.com/',
    });

    const prometheusWorkspace = new CfnWorkspace(this, 'Workspace', {
      alias: 'Overwatch',
      alertManagerDefinition: `
        template_files:
          default_template: |
            {{ define "sns.default.message" }}{"receiver":"{{ .Receiver }}","source":"prometheus","status":"{{ .Status }}","alerts":[{{ range $alertIndex, $alerts := .Alerts }}{{ if $alertIndex }},{{ end }}{"status":"{{ $alerts.Status }}",{{ if gt (len $alerts.Labels.SortedPairs) 0 }}"labels":{{ "{" }}{{ range $index, $label := $alerts.Labels.SortedPairs }}{{ if $index }},{{ end }}"{{ $label.Name }}":"{{ $label.Value }}"{{ end }}{{ "}" }},{{ end }}{{ if gt (len $alerts.Annotations.SortedPairs) 0 }}"annotations":{{ "{" }}{{ range $index, $annotations := $alerts.Annotations.SortedPairs }}{{ if $index }},{{ end }}"{{ $annotations.Name }}":"{{ $annotations.Value }}"{{ end }}{{ "}" }}{{ end }}}{{ end }}]}{{ end }}
            {{ define "sns.default.subject" }}[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}]{{ end }}
        alertmanager_config: |
          global:
          templates:
            - 'default_template'
          inhibit_rules:
          - source_match:
              severity: 'critical'
            target_match:
              severity: 'warning'
            equal: ['alertname']
          route:
            receiver: 'sns'
            group_by: ['...']
          receivers:
            - name: 'sns'
              sns_configs:
                - subject: 'prometheus_alert'
                  sigv4:
                    region: '${process.env.CDK_DEFAULT_REGION}'
                  topic_arn: '${alertsTopic.topic.topicArn}'
        `,
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
