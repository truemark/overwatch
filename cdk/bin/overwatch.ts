#!/usr/bin/env node
import 'source-map-support/register';
import {ExtendedApp} from 'truemark-cdk-lib/aws-cdk';
import {OverwatchStack} from '../lib/overwatch-stack';

const app = new ExtendedApp({
  standardTags: {
    automationTags: {
      id: 'overwatch',
      url: 'https://github.com/truemark/overwatch',
    },
  },
});

const idpEntityId = app.node.tryGetContext('idpEntityId');
if (!idpEntityId) {
  throw new Error('Missing idpEntityId in context');
}
const idpMetadataContent = app.node.tryGetContext('idpMetadataContent');
if (!idpMetadataContent) {
  throw new Error('Missing idpMetadataContent in context');
}
const domainName = app.node.tryGetContext('domainName');
if (!domainName) {
  throw new Error('Missing domainName in context');
}
const zoneName = app.node.tryGetContext('zoneName');
if (!zoneName) {
  throw new Error('Missing zoneName in context');
}
const hostedZoneId = app.node.tryGetContext('zoneId');
if (!hostedZoneId) {
  throw new Error('Missing zoneId in context');
}
const masterUserArn = app.node.tryGetContext('masterUserArn');
if (!masterUserArn) {
  throw new Error('Missing masterUserArn in context');
}
const masterBackendRole = app.node.tryGetContext('masterBackendRole');
if (!masterBackendRole) {
  throw new Error('Missing masterBackendRole in context');
}
let accountIds = app.node.tryGetContext('accountIds');
if (!accountIds) {
  throw new Error('Missing accountIds in context');
}
accountIds = accountIds.split(',');

new OverwatchStack(app, 'Overwatch', {
  volumeSize: 200,
  masterUserArn,
  idpEntityId,
  idpMetadataContent,
  masterBackendRole,
  hostedDomainName: {
    domainName,
    zone: {
      hostedZoneId,
      zoneName,
    },
  },
  accountIds,
});
