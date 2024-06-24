import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {Construct} from 'constructs';
import {OverwatchSupportConstruct} from './overwatch-support-construct';
import {Vpc} from 'aws-cdk-lib/aws-ec2';
import {App} from 'aws-cdk-lib';
import {AccountAlarms} from './account-alarms';

export interface OverwatchSupportStackProps extends ExtendedStackProps {
  readonly primaryRegion?: boolean;
  readonly vpcId: string;
  readonly availabilityZones: string[];
  readonly privateSubnetIds: string[];
}

export class OverwatchSupportStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: OverwatchSupportStackProps) {
    super(scope, id, props);

    if (props.primaryRegion ?? true) {
      // TODO Create observability role
      new AccountAlarms(this, 'Alarms');
    }

    const vpc = Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: props.availabilityZones,
      privateSubnetIds: props.privateSubnetIds,
    });
    new OverwatchSupportConstruct(this, 'Default', {
      vpc,
    });
  }

  static propsFromContext(app: App): OverwatchSupportStackProps {
    let primaryRegion = app.node.tryGetContext('primaryRegion');
    primaryRegion = primaryRegion === undefined || primaryRegion === 'true';
    const vpcId = app.node.tryGetContext('vpcId');
    if (!vpcId) {
      throw new Error('vpcId is required in context');
    }
    let availabilityZones = app.node.tryGetContext('availabilityZones');
    if (!availabilityZones) {
      throw new Error('availabilityZones is required in context');
    }
    availabilityZones = availabilityZones
      .split(',')
      .map((az: string) => az.trim());
    let privateSubnetIds = app.node.tryGetContext('privateSubnetIds');
    if (!privateSubnetIds) {
      throw new Error('privateSubnetIds is required in context');
    }
    privateSubnetIds = privateSubnetIds
      .split(',')
      .map((id: string) => id.trim());
    return {
      primaryRegion,
      vpcId,
      availabilityZones,
      privateSubnetIds,
    };
  }

  static fromContext(app: App, id: string): OverwatchSupportStack {
    return new OverwatchSupportStack(
      app,
      id,
      OverwatchSupportStack.propsFromContext(app)
    );
  }
}
