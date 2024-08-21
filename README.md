# Overwatch

This repository houses the customer facing automation for the TrueMark Overwatch project which provides
a standard observability pattern that includes infrastructure and automation around logging, monitoring,
and alerting.

This project consists of the following stacks

| Stack            | Description                                    | Deployment Pattern        |
|------------------|------------------------------------------------|---------------------------|
| Overwatch        | Central observability infrastructure           | One account in one region |
| OverwatchSupport | Region specific observability infrastructure   | Every account and region  |

## Overwatch Install

The following command will install the Overwatch stack

```bash
git clone git@github.com:truemark/overwatch.git
cd overwatch
npx pnpm@latest build
cd cdk
npx aws-cdk@2.x deploy \
-c stack="overwatch" \
-c idpEntityId="{{ idpEntityId }}" \
-c idpMetadataContent="{{ idpMetadataContent }}" \
-c domainName="{{ domainName }}" \
-c zoneId="{{ zoneId }}" \
-c zoneName=="{{ zoneName }}" \
-c masterBackendRole="{{ masterBackendRole }}" \
-c accountIds="{{ accountIds }}" \
-c adminGroups="{{ adminGroups }}" \
-c editorGroups="{{ editorGroups }}" \
-c organizationalUnits="{{ organizationalUnits }}" \
-c volumeSize="{{ volumeSize }}" \
-c dataNodeInstanceType="{{ dataNodeInstanceType }}" \
-c devRoleBackendIds="{{ devRoleBackendIds }}" \
```

## Overwatch Support Install

```bash
git clone git@github.com:truemark/overwatch.git
cd overwatch
npx pnpm@latest build
cd cdk
npx aws-cdk@2.x deploy  \
-c stack="support" \
-c vpcId="{{ vpcId }}" \
-c availabilityZones="{{ availabilityZones }}" \
-c privateSubnetIds="{{ privateSubnetIds }}" \
-c vpcCidrBlock="{{ vpcCidrBlock }}"
```

## Supported Tags

Any tags that support multiple values are separated by a comma unless explicitly stated otherwise.

### EC2 Tags

| Tag               | Values                         | Multi-Valued | Description                             |
|-------------------|--------------------------------|--------------|-----------------------------------------|
| overwatch:install | all, node-exporter, fluent-bit | Yes          | Triggers application installs using SSM |

### CloudWatch Log Groups

| Tag               | Description                             |
|-------------------|-----------------------------------------|
| autolog:dest      | The destination logs will be written to |

The following destination patterns are supported

| Destination                  | Description                                                                                                                                                      |
|------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| {{bucketName}}/{{indexName}} | Logs will be written to an s3 bucket managed by [overwatch](https://github.com/truemark/overwatch) using the path /autolog/{{indexName}}/{{account}}/{{region}}/ |

## Deployed Services

The following AWS services are used in the Overwatch project

**Overwatch**

 - Grafna Setup (optional)
   - AWS Grafana

 - Logs Setup (optional)
   - AWS OpenSearch
   - AWS OpenSearch Ingestion Pipelines
   - AWS S3 (optional) - used to store logs
   - AWS Lambda - used to create ingestion pipelines and push configs to OpenSearch
   - AWS SQS - used to receive log file events to S3

Overwatch Support

 - Overwatch Support Base
   - AWS SNS - used to delivery alerts from Prometheus, Grafana and OpenSearch
   - AWS Managed Prometheus - used to collect metrics

 - Overwatch Install
   - AWS SSM Documents - used to optionall automate application installs for Fluentbit and Node Exporter
   - AWS Lambda - used to handle SSM Document executions
   - SSM Parameter Store - used to store application install scripts

 - Overwatch AutoLog
   - AWS Firehose - used to deliver logs to S3
   - AWS Lambda - Used to handle tag events, log events, etc.
   - AWS CloudWatch Logs Subscription Filters - used to deliver logs to Firehose

All stacks that are part of Overwatch also use AWS IAM to create roles used to the services deployed.
