import {Construct} from 'constructs';

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
  }
}
