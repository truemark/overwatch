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

