# Overwatch

This repository houses the customer facing automation for the TrueMark Overwatch project which provides
a standard observability pattern that includes infrastructure and automation around logging, monitoring,
and alerting.

This project consists of the following stacks

| Stack            | Description                                    | Deployment Pattern        |
|------------------|------------------------------------------------|---------------------------|
| Overwatch        | Central observability infrastructure           | One account in one region |
| OverwatchSupport | Region specific observability infrastructure   | Every account and region  |
| OverwatchMetrics | Metrics generation and collection              | Every account and region  |


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
