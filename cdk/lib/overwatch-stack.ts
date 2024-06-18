import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {Construct} from 'constructs';
import {Overwatch} from './overwatch-construct';
import {HostedDomainNameProps} from './standard-domain';

export interface OverwatchStackProps extends ExtendedStackProps {
  readonly volumeSize?: number;
  readonly idpEntityId: string;
  readonly idpMetadataContent: string;
  readonly masterBackendRole: string;
  readonly hostedDomainName?: HostedDomainNameProps;
  readonly accountIds: string[];
}

export class OverwatchStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: OverwatchStackProps) {
    super(scope, id, props);
    new Overwatch(this, 'Default', {
      ...props,
    });
  }
}
