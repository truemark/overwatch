import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {Construct} from 'constructs';
import {OverwatchSupportConstruct} from './overwatch-support-construct';
import {IVpc, Vpc} from 'aws-cdk-lib/aws-ec2';

export interface OverwatchSupportStackProps extends ExtendedStackProps {
  readonly vpcId: string;
  readonly availabilityZones: string[];
  readonly privateSubnetIds: string[];
  readonly vpcCidrBlock: string;
}

export class OverwatchSupportStack extends ExtendedStack {
  readonly vpc: IVpc;
  constructor(scope: Construct, id: string, props: OverwatchSupportStackProps) {
    super(scope, id, props);
    this.vpc = Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: props.availabilityZones,
      privateSubnetIds: props.privateSubnetIds,
      vpcCidrBlock: props.vpcCidrBlock,
    });
    new OverwatchSupportConstruct(this, 'OverwatchSupport', {
      vpc: this.vpc,
    });
  }
}
