#!/usr/bin/env node
import 'source-map-support/register';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {OverwatchStack} from '../lib/overwatch';
import {OverwatchSupportStack} from '../lib/support';

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'overwatch',
      url: 'https://github.com/truemark/overwatch',
    },
  },
});

OverwatchStack.fromContext(app, 'Overwatch');
OverwatchSupportStack.fromContext(app, 'OverwatchSupport');
