#!/usr/bin/env node
import 'source-map-support/register';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {OverwatchStack} from '../lib/overwatch';
import {OverwatchSupportStack} from '../lib/support';
import {OverwatchMetricsStack} from '../lib/metrics';

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'overwatch',
      url: 'https://github.com/truemark/overwatch',
    },
  },
});

const stack = app.node.tryGetContext('stack');
if (!stack) {
  throw new Error('stack is required in context');
}
if (stack === 'overwatch') {
  OverwatchStack.fromContext(app, 'Overwatch');
} else if (stack === 'support') {
  OverwatchSupportStack.fromContext(app, 'OverwatchSupport');
} else if (stack === 'metrics') {
  OverwatchMetricsStack.fromContext(app, 'OverwatchMetrics');
} else {
  throw new Error(`Unknown stack: ${stack}`);
}
