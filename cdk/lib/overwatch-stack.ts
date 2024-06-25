import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {Construct} from 'constructs';
import {
  GrafanaConfig,
  LogsConfig,
  Overwatch,
  OverwatchProps,
} from './overwatch-construct';
import {App} from 'aws-cdk-lib';

export interface OverwatchStackProps
  extends ExtendedStackProps,
    OverwatchProps {}

export class OverwatchStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: OverwatchStackProps) {
    super(scope, id, props);
    new Overwatch(this, 'Default', props);
  }

  static propsFromContext(app: App): OverwatchStackProps {
    let skipGrafana = app.node.tryGetContext('skipGrafana');
    if (skipGrafana) {
      skipGrafana = skipGrafana === 'true';
    }
    let grafanaConfig: GrafanaConfig | undefined = undefined;
    if (!skipGrafana) {
      let adminGroups = app.node.tryGetContext('adminGroups');
      if (adminGroups) {
        adminGroups = adminGroups.split(',');
      }
      let editorGroups = app.node.tryGetContext('editorGroups');
      if (editorGroups) {
        editorGroups = editorGroups.split(',');
      }
      let organizationalUnits = app.node.tryGetContext('organizationalUnits');
      if (!organizationalUnits) {
        throw new Error('Missing organizationalUnits in context');
      } else {
        organizationalUnits = organizationalUnits.split(',');
      }
      grafanaConfig = {
        adminGroups,
        editorGroups,
        organizationalUnits,
      };
    }

    let skipLogs = app.node.tryGetContext('skipLogs');
    if (skipLogs) {
      skipLogs = skipLogs === 'true';
    }
    let logsConfig: LogsConfig | undefined = undefined;
    if (!skipLogs) {
      let volumeSize = app.node.tryGetContext('volumeSize');
      if (!volumeSize) {
        throw new Error('volumeSize is required in context');
      }
      volumeSize = parseInt(volumeSize, 10);
      const idpEntityId = app.node.tryGetContext('idpEntityId');
      if (!idpEntityId) {
        throw new Error('idpEntityId is required in context');
      }
      const idpMetadataContent = app.node.tryGetContext('idpMetadataContent');
      if (!idpMetadataContent) {
        throw new Error('idpMetadataContent is required in context');
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
      const masterBackendRole = app.node.tryGetContext('masterBackendRole');
      if (!masterBackendRole) {
        throw new Error('openSearchMasterBackendRole is required in context');
      }
      let accountIds = app.node.tryGetContext('accountIds');
      if (!accountIds) {
        throw new Error('Missing accountIds in context');
      }
      accountIds = accountIds.split(',');
      logsConfig = {
        volumeSize,
        idpEntityId,
        idpMetadataContent,
        masterBackendRole,
        hostedDomainName: {
          domainName,
          zone: zoneName,
        },
        accountIds,
      };
    }
    return {
      logsConfig,
      grafanaConfig,
    };
  }

  static fromContext(app: App, id: string): OverwatchStack {
    return new OverwatchStack(app, id, OverwatchStack.propsFromContext(app));
  }
}
