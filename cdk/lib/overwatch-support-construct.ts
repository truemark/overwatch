import {Construct} from 'constructs';
import {StringParameter, CfnDocument} from 'aws-cdk-lib/aws-ssm';
import {
  IVpc,
  SecurityGroup,
  Port,
  Peer,
  CfnInstance,
} from 'aws-cdk-lib/aws-ec2';
import {PrometheusScraper} from './prometheus-scraper';
import {Cluster} from 'aws-cdk-lib/aws-ecs';
import {CfnRuleGroupsNamespace, CfnWorkspace} from 'aws-cdk-lib/aws-aps';

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

    const prometheusWorkspace = new CfnWorkspace(this, 'OverwatchWorkspace', {
      alias: 'OverwatchMetrics', // Optional alias for the workspace
    });
    // Create a Rule Groups Namespace
    // Create a Rule Groups Namespace
    const ruleGroupsNamespace = new CfnRuleGroupsNamespace(
      this,
      'MyRuleGroupsNamespace',
      {
        workspace: prometheusWorkspace.ref,
        name: 'default', // Name of the rule groups namespace
        data: JSON.stringify({
          groups: [
            {
              name: 'example.rules',
              rules: [
                {
                  alert: 'HighCpuUsage',
                  expr: 'avg by (instance) (rate(node_cpu_seconds_total{mode!="idle"}[5m])) > 0.95',
                  for: '5m',
                  labels: {
                    severity: 'critical',
                  },
                  annotations: {
                    summary:
                      'Instance {{ $labels.instance }} has high CPU usage',
                    description:
                      'CPU usage is above 95% for more than 5 minutes.',
                  },
                },
              ],
            },
          ],
        }),
      }
    );
    // Create Security group for Prometheus data to be scraped
    const vpc = props.vpc;
    // Create a security group within the VPC
    const securityGroup = new SecurityGroup(this, 'PrometheusSecurityGroup', {
      vpc,
      securityGroupName: 'prometheus-sg',
      description: 'Allow Prometheus scraping on port 9100 within the VPC',
      allowAllOutbound: true,
    });
    // Allow inbound traffic on port 9100 from within the VPC
    securityGroup.addIngressRule(
      Peer.ipv4(vpc.vpcCidrBlock),
      Port.tcp(9100),
      'Allow Prometheus scraping'
    );

    const nodeExporterServiceConfig = `
    [Unit]
    Description=Node Exporter
    After=network.target

    [Service]
    User=prometheus
    ExecStart=/etc/prometheus/node_exporter/node_exporter

    [Install]
    WantedBy=default.target
    `;
    const nodeExporterServiceConfigParam = new StringParameter(
      this,
      'NodeExporterServiceConfigParam',
      {
        parameterName: '/prometheus-config/NodeExporter-ServiceConfig',
        stringValue: nodeExporterServiceConfig,
        description: 'The Node Exporter service configuration',
      }
    );
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
          default: '{{ ssm:/prometheus-config/NodeExporter-ServiceConfig }}',
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
            runCommand: [
              'Invoke-WebRequest -Uri {{ WindowsExporterPackageUrl }} -OutFile C:\\windows\\temp\\windows_exporter.msi',
              "Start-Process msiexec.exe -ArgumentList '/i C:\\windows\\temp\\windows_exporter.msi /quiet' -NoNewWindow -Wait",
              'Remove-Item C:\\windows\\temp\\windows_exporter.msi',
              "# Stop the service if it's running",
              'Stop-Service -Name windows_exporter -ErrorAction SilentlyContinue',
              '# Delete the existing service',
              'sc.exe delete windows_exporter',
              '$ErrorActionPreference = "Stop"',
              '$commandLine =\'"C:/Program Files/windows_exporter/windows_exporter.exe" --web.listen-address=:9100\'',
              "New-Service -Name 'windows_exporter' -BinaryPathName $commandLine -DisplayName 'Windows Exporter' -StartupType Automatic",
              'Start-Service -Name "windows_exporter"',
              'New-NetFirewallRule -DisplayName "Allow Node Exporter" -Direction Inbound -Protocol TCP -LocalPort 9100 -Action Allow',
            ],
          },
        },
        {
          precondition: {
            StringEquals: ['platformType', 'Linux'],
          },
          action: 'aws:runShellScript',
          name: 'InstallNodeExporterLinux',
          inputs: {
            runCommand: [
              // Determine architecture and set package URLs accordingly
              'ARCH=$(uname -m)',
              'if [ "$ARCH" == "x86_64" ]; then',
              "  NODE_EXPORTER_PACKAGE_URL='{{ NodeExporterPackageUrl }}'",
              'elif [ "$ARCH" == "aarch64" ]; then',
              "  NODE_EXPORTER_PACKAGE_URL='{{ NodeExporterPackageUrlArm }}'",
              'else',
              "  echo 'Unsupported architecture: $ARCH'",
              '  exit 1',
              'fi',
              'sudo useradd --no-create-home --shell /bin/false prometheus | >/dev/null 2>&1',
              'sudo mkdir -p /etc/prometheus',
              'sudo mkdir -p /var/lib/prometheus',
              'sudo chown prometheus:prometheus /etc/prometheus',
              'sudo chown prometheus:prometheus /var/lib/prometheus',
              "echo 'Downloading and configuring Node Exporter'",
              'sudo systemctl stop node_exporter >/dev/null 2>&1',
              'wget $NODE_EXPORTER_PACKAGE_URL >/dev/null 2>&1',
              'tar xfz node_exporter-*.tar.gz',
              'mv node_exporter-*64 node_exporter',
              'sudo rm -rf /etc/prometheus/node_exporter',
              'sudo mv node_exporter/ /etc/prometheus/node_exporter/',
              'rm node_exporter-*.tar.gz',
              'sudo chown -R prometheus:prometheus /etc/prometheus/node_exporter',
              'sudo echo "{{ NodeExporterServiceConfig }}" > /etc/systemd/system/node_exporter.service',
              'sudo systemctl daemon-reload',
              'sudo systemctl enable node_exporter >/dev/null 2>&1',
              'sudo systemctl start node_exporter',
            ],
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
      vpc: vpc,
    });
    // Create Prometheus scraper
    new PrometheusScraper(this, 'PrometheusScraper', {
      cluster: cluster,
      workspace: prometheusWorkspace,
    });
    //   new PrometheusScraper();
    //
    //   // TODO Add role assignment for Grafana
  }
}
