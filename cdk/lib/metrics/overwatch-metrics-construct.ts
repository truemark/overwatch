import {LogLevel} from '../types';
import {ExtendedConstruct} from 'truemark-cdk-lib/aws-cdk';
import {Construct} from 'constructs';

export interface OverwatchMetricsConstructProps {
  readonly logLevel?: LogLevel;
}

export class OverwatchMetricsConstruct extends ExtendedConstruct {
  constructor(
    scope: Construct,
    id: string,
    props: OverwatchMetricsConstructProps
  ) {
    super(scope, id);

    // TODO Add code here
  }
}
