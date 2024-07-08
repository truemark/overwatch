import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {Construct} from 'constructs';
import {LogLevel} from '../types';
import {OverwatchMetricsConstruct} from './overwatch-metrics-construct';
import {App} from 'aws-cdk-lib';

export interface OverwatchMetricsStackProps extends ExtendedStackProps {
  readonly logLevel?: LogLevel;
}

export class OverwatchMetricsStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: OverwatchMetricsStackProps) {
    super(scope, id, props);

    new OverwatchMetricsConstruct(this, 'Default', {});
  }

  static propsFromContext(app: App): OverwatchMetricsStackProps {
    // TODO Read settings from app.node.tryGetContext here
    return {
      logLevel: 'trace',
    };
  }

  static fromContext(app: App, id: string): OverwatchMetricsStack {
    return new OverwatchMetricsStack(
      app,
      id,
      OverwatchMetricsStack.propsFromContext(app)
    );
  }
}
