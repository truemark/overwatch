import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {Construct} from 'constructs';
import {OverwatchConstruct} from './overwatch-construct';

export class OverwatchStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: ExtendedStackProps) {
    super(scope, id, props);
    new OverwatchConstruct(this, 'Overwatch');
  }
}
