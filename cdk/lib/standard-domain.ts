import {Construct} from 'constructs';
import {EngineVersion, Domain} from 'aws-cdk-lib/aws-opensearchservice';
import {RemovalPolicy} from 'aws-cdk-lib';
import {EbsDeviceVolumeType} from 'aws-cdk-lib/aws-ec2';
import {
  Effect,
  IPrincipal,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
  Certificate,
  CertificateValidation,
} from 'aws-cdk-lib/aws-certificatemanager';
import {HostedZone, IHostedZone} from 'aws-cdk-lib/aws-route53';

export interface HostedZoneAttributes {
  readonly hostedZoneId: string;
  readonly zoneName: string;
}

function isHostedZoneAttributes(
  zone: HostedZoneAttributes | IHostedZone,
): zone is HostedZoneAttributes {
  return (zone as HostedZoneAttributes).hostedZoneId !== undefined;
}

export interface HostedDomainNameProps {
  readonly domainName: string;
  readonly zone: HostedZoneAttributes | IHostedZone;
}

/**
 * Properties for StandardOpenSearchDomain.
 */
export interface StandardDomainProps {
  /**
   * Number of master nodes to create. Default is 3. Value is required to be an odd number.
   */
  readonly masterNodes?: number;

  /**
   * The instance type for the master nodes. Default is m6g.large.search.
   */
  readonly masterNodeInstanceType?: string;

  /**
   * Number of data nodes to create. Default is 2.
   */
  readonly dataNodes?: number;

  /**
   * The instance type for data nodes. Default is r6g.large.search.
   */
  readonly dataNodeInstanceType?: string;

  /**
   * The number of warm nodes to create. Default is 0.
   */
  readonly warmNodes?: number;

  /**
   * The instance type for warm nodes. Default is ultrawarm1.medium.search.
   */
  readonly warmNodeInstanceType?: string;

  /**
   * Determines if the Multi-AZ with Standby is enabled. Default is false. The difference is 99.9% availability vs 99.99% which is not needed in most cases.
   */
  readonly multiAzWithStandbyEnabled?: boolean;

  /**
   * The volume size of the domain in GB. The default is 100.
   */
  readonly volumeSize?: number;

  /**
   * The volume type to use. The default is GENERAL_PURPOSE_SSD_GP3.
   */
  readonly volumeType?: EbsDeviceVolumeType;

  /**
   * The number of IOPS to provision for the volume. The default is 3000.
   */
  readonly iops?: number;

  /**
   * The throughput to provision for the volume. The default is 125.
   */
  readonly throughput?: number;

  /**
   * The engine version of the domain. The default is OPENSEARCH_2_11.
   */
  readonly engineVersion?: EngineVersion;

  /**
   * Specifies the removal policy for the domain. The default is RETAIN.
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Enforces a particular physical domain name. The default is a generated name.
   */
  readonly domainName?: string;

  /**
   * Enabled automatic software updates. Default is true.
   */
  readonly enableAutoSoftwareUpdate?: boolean;

  /**
   * The user to use for fine-grained access control.
   */
  readonly masterUserArn: string;

  /**
   * SAML Identity Provider Entity ID.
   */
  readonly idpEntityId: string;

  /**
   * SAML Identity Provider Metadata Document. Quotes need to be escaped.
   */
  readonly idpMetadataContent: string;

  /**
   * The role to use for the master backend.
   */
  readonly masterBackendRole: string;

  /**
   * The role key used in the SAML assertion. Default is Role.
   */
  readonly roleKey?: string;

  /**
   * The session timeout for the SAML assertion. Default is 480 minutes.
   */
  readonly sessionTimeoutMinutes?: number;

  /**
   * Additional principals to grant write access to the domain.
   */
  readonly writeAccess?: IPrincipal[];

  /**
   * The hosted domain name for the OpenSearch domain. No route53 record is created if this is not provided.
   */
  readonly hostedDomainName?: HostedDomainNameProps;

  /**
   * The number of availability zones to use. Default is 2.
   */
  readonly availabilityZoneCount?: number;

  /**
   * The max clause count to use. Default is 1000.
   */
  readonly maxClauseCount?: string;

  /**
   * The field data cache size to use. Default is 20.
   */
  readonly fieldDataCacheSize?: string;
}

/**
 * Creates an OpenSearch domain following best practices and reasonable defaults.
 */
export class StandardDomain extends Construct {
  readonly domain: Domain;
  readonly domainArn: string;
  readonly domainEndpoint: string;
  constructor(scope: Construct, id: string, props: StandardDomainProps) {
    super(scope, id);

    let hostedZone;
    let certificate;
    if (props.hostedDomainName) {
      hostedZone = isHostedZoneAttributes(props.hostedDomainName.zone)
        ? HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
            hostedZoneId: props.hostedDomainName.zone.hostedZoneId,
            zoneName: props.hostedDomainName.zone.zoneName,
          })
        : props.hostedDomainName.zone;
      certificate = new Certificate(this, 'Certificate', {
        domainName: props.hostedDomainName.domainName,
        validation: CertificateValidation.fromDns(hostedZone),
      });
    }

    this.domain = new Domain(this, 'Default', {
      version: props.engineVersion ?? EngineVersion.OPENSEARCH_2_11,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
      domainName: props.domainName ?? 'default-domain',
      capacity: {
        masterNodes: props.masterNodes ?? 3,
        masterNodeInstanceType:
          props.masterNodeInstanceType ?? 'm6g.large.search',
        dataNodes: props.dataNodes ?? 2,
        dataNodeInstanceType: props.dataNodeInstanceType ?? 'r6g.large.search',
        warmNodes: props.warmNodes ?? 0,
        warmInstanceType:
          props.warmNodeInstanceType ?? 'ultrawarm1.medium.search',
        multiAzWithStandbyEnabled: props.multiAzWithStandbyEnabled ?? false,
      },
      // TODO Add zoneAwareness for private domains
      ebs: {
        volumeSize: props.volumeSize ?? 100,
        volumeType:
          props.volumeType ?? EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
        iops: props.iops ?? 3000,
        throughput: props.throughput ?? 250,
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
        masterUserArn: props.masterUserArn,
        samlAuthenticationEnabled: true,
        samlAuthenticationOptions: {
          idpEntityId: props.idpEntityId,
          idpMetadataContent: props.idpMetadataContent,
          masterBackendRole: props.masterBackendRole,
          rolesKey: props.roleKey ?? 'Role',
          sessionTimeoutMinutes: props.sessionTimeoutMinutes ?? 480,
        },
      },
      customEndpoint: props.hostedDomainName
        ? {
            domainName: props.hostedDomainName.domainName,
            certificate,
            hostedZone,
          }
        : undefined,
      zoneAwareness: {
        availabilityZoneCount: props.availabilityZoneCount ?? 2,
      },
      advancedOptions: {
        'indices.fielddata.cache.size': props.fieldDataCacheSize ?? '20',
        'indices.query.bool.max_clause_count': props.maxClauseCount ?? '1000',
      },
    });

    // Create an IAM Role for OpenSearch Ingestion
    const ingestionRole = new Role(this, 'IngestionRole', {
      assumedBy: new ServicePrincipal('osis.amazonaws.com'),
      description: 'Role for OpenSearch Ingestion',
    });

    // Attach policy to the role to allow writing to OpenSearch
    ingestionRole.addToPolicy(
      new PolicyStatement({
        actions: ['es:ESHttpPost', 'es:ESHttpPut'],
        resources: [this.domain.domainArn, `${this.domain.domainArn}/*`],
      }),
    );

    this.domain.addAccessPolicies(
      new PolicyStatement({
        actions: [
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpGet',
          'es:ESHttpDelete',
          'es:ESHttpHead',
        ],
        effect: Effect.ALLOW,
        principals: [...(props.writeAccess ?? []), ingestionRole],
        resources: [this.domain.domainArn, `${this.domain.domainArn}/*`],
      }),
    );
    this.domainArn = this.domain.domainArn;
    this.domainEndpoint = this.domain.domainEndpoint;
  }
}
