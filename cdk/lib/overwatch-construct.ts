import {Construct} from 'constructs';
import {Domain, EngineVersion} from 'aws-cdk-lib/aws-opensearchservice';
import {PolicyStatement, AnyPrincipal, Effect} from 'aws-cdk-lib/aws-iam';
import {EbsDeviceVolumeType} from 'aws-cdk-lib/aws-ec2';
import {RemovalPolicy} from 'aws-cdk-lib';

export class OverwatchConstruct extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // TODO Add AWS Managed Grafana

    /* TODO Fouad Add OpenSearch Domain - See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_opensearchservice-readme.html
      Do not have this code create a service linked role. That will be done in another project.
      Ensure encryption is enabled
      Enable fine grained access control
      We want to do SAML authentication to AWS IAM Identity Center (can be added last)
      Add a custom access policy to allow data to be written from other accounts. You can harcode the accounts in here for now.
      Enable auditlogs
      Enable ultrawarm
      Enable software updates
      The Domain will be public
      Deploy into your dev account for now
    */

    // Create OpenSearch Domain
    const domain = new Domain(this, 'LogsOpenSearchDomain', {
      version: EngineVersion.OPENSEARCH_2_11,
      removalPolicy: RemovalPolicy.DESTROY,
      domainName: 'os-logs-domain',
      enableAutoSoftwareUpdate: true,
      capacity: {
        warmNodes: 3,
        masterNodes: 3,
        dataNodes: 3,
        dataNodeInstanceType: 'r5.large.search',
        masterNodeInstanceType: 'r5.large.search',
        warmInstanceType: 'ultrawarm1.medium.search',
      },
      zoneAwareness: {
        enabled: true,
        availabilityZoneCount: 3,
      },
      ebs: {
        volumeSize: 10, // GiB
        volumeType: EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
      },
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true,
        auditLogEnabled: true,
      },
      encryptionAtRest: {
        enabled: true,
      },
      nodeToNodeEncryption: true,
      enforceHttps: true,
      useUnsignedBasicAuth: false,
      enableVersionUpgrade: true,
      fineGrainedAccessControl: {
        masterUserName: 'logsadmin',
        // samlAuthenticationEnabled: true,
        // samlAuthenticationOptions: {
        //   idpEntityId: 'entity-id',
        //   idpMetadataContent: 'metadata-content-with-quotes-escaped',
        // },
      },
    });

    domain.addAccessPolicies(
      new PolicyStatement({
        actions: [
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpGet',
          'es:ESHttpDelete',
        ],
        effect: Effect.ALLOW,
        principals: [new AnyPrincipal()],
        resources: [domain.domainArn, `${domain.domainArn}/*`],
      })
    );
  }
}
