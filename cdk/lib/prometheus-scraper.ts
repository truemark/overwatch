import {Construct} from 'constructs';
import {ContainerImage, ICluster} from 'aws-cdk-lib/aws-ecs';
import {StandardFargateService} from 'truemark-cdk-lib/aws-ecs';
import {CfnWorkspace} from 'aws-cdk-lib/aws-aps';
import {ManagedPolicy, Role, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import {join} from 'node:path';
import {DockerImageAsset, Platform} from 'aws-cdk-lib/aws-ecr-assets';

export interface PrometheusScraperProps {
  readonly cluster: ICluster;
  readonly workspace: CfnWorkspace;
}

export class PrometheusScraper extends Construct {
  constructor(scope: Construct, id: string, props: PrometheusScraperProps) {
    super(scope, id);

    //Create the Docker image that will be used by the Task
    const asset = new DockerImageAsset(this, 'ServerImage', {
      directory: join(__dirname, '..', '..'),
      file: 'Dockerfile',
      exclude: ['cdk'],
      platform: Platform.LINUX_ARM64,
    });

    const taskRole = new Role(this, 'PrometheusTaskRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    taskRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess')
    );
    taskRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        'AmazonPrometheusRemoteWriteAccess'
      )
    );
    taskRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ReadOnlyAccess')
    );
    taskRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        'AmazonEC2ContainerRegistryReadOnly'
      )
    );
    // use TrueMark's StandardFargateService
    const fargateprometheus = new StandardFargateService(
      this,
      'Prometheus-scraper',
      {
        cluster: props.cluster,
        image: ContainerImage.fromDockerImageAsset(asset),
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 1,
        environment: {
          PROMETHEUS_CONFIG: '/prometheus/config',
          REMOTE_WRITE_URL:
            props.workspace.attrPrometheusEndpoint + 'api/v1/remote_write',
        },
        enableExecuteCommand: true,
      }
    );
    fargateprometheus.taskDefinition.taskRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        'AmazonPrometheusRemoteWriteAccess'
      )
    );
    fargateprometheus.taskDefinition.taskRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ReadOnlyAccess')
    );
  }
}
