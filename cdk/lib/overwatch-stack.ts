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

      const subnetIds = app.node.tryGetContext('grafanaVPCSubnetIds')
        ? app.node.tryGetContext('grafanaVPCSubnetIds').split(',')
        : undefined;

      const securityGroupIds = app.node.tryGetContext(
        'grafanaVPCSecurityGroupIds'
      )
        ? app.node.tryGetContext('grafanaVPCSecurityGroupIds').split(',')
        : undefined;

      grafanaConfig = {
        adminGroups,
        editorGroups,
        organizationalUnits,
        vpcConfiguration:
          subnetIds && securityGroupIds
            ? {
                subnetIds,
                securityGroupIds,
              }
            : undefined,
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
      const dataNodeInstanceType = app.node.tryGetContext(
        'dataNodeInstanceType'
      );
      if (!dataNodeInstanceType) {
        throw new Error('Missing dataNodeInstanceType in context');
      }
      const devRoleBackendIds = app.node.tryGetContext('devRoleBackendIds');
      if (!devRoleBackendIds) {
        throw new Error('Missing devRoleBackendIds in context');
      }
      accountIds = accountIds.split(',');
      const s3GlacierIRTransitionDays = parseNumberContext(
        app,
        's3GlacierIRTransitionDays'
      );
      const s3ExpirationDays = parseNumberContext(app, 's3ExpirationDays');

      logsConfig = {
        volumeSize,
        idpEntityId,
        idpMetadataContent,
        masterBackendRole,
        hostedDomainName: {
          domainName,
          zone: {
            zoneName,
            hostedZoneId,
          },
        },
        accountIds,
        dataNodeInstanceType,
        devRoleBackendIds,
        s3GlacierIRTransitionDays,
        s3ExpirationDays,
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
function parseNumberContext(app: App, key: string): number | undefined {
  const raw = app.node.tryGetContext(key);
  if (raw === undefined) return undefined;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Invalid value for context "${key}": must be a number, got "${raw}"`
    );
  }
  return parsed;
}
