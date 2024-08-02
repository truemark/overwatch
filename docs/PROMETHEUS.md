
# Prometheus and Alertmanager Configuration Guide

## Prometheus Configuration

### Enabling Remote Write to AWS Managed Prometheus

To enable remote write to AWS Managed Prometheus from a self-hosted Prometheus instance, you need to configure the `remote_write` section in your Prometheus configuration file. Below are the steps to do this using different authentication methods: IAM role, IAM keys, and IAM Roles for Service Accounts (IRSA).

#### 1. IAM Role

1. **Create an IAM Role with Prometheus Permissions**:
    - Attach a policy to the role that allows `aps:RemoteWrite`.

2. **Attach the IAM Role to the EC2 Instance** running Prometheus:
    - Ensure the instance profile is attached to the EC2 instance.

3. **Update Prometheus Configuration**:
    - Edit the `prometheus.yml` file to include the remote write configuration with SigV4 authentication.

```yaml
remote_write:
- url: "https://aps-workspaces.<region>.amazonaws.com/workspaces/<workspace-id>/api/v1/remote_write"
  sigv4:
    region: <region>
  queue_config:
    capacity: 2500
    max_samples_per_send: 500
    max_shards: 200
    min_shards: 1
```

#### 2. IAM Keys

1. **Create an IAM User with Prometheus Permissions**:
    - Attach a policy to the user that allows `aps:RemoteWrite`.
    - Generate access keys for the user.

2. **Update Prometheus Configuration**:
    - Edit the `prometheus.yml` file to include the remote write configuration with basic authentication using the IAM keys.

```yaml
remote_write:
- url: "https://aps-workspaces.<region>.amazonaws.com/workspaces/<workspace-id>/api/v1/remote_write"
  basic_auth:
    username: <access_key_id>
    password: <secret_access_key>
  queue_config:
    capacity: 2500
    max_samples_per_send: 500
    max_shards: 200
    min_shards: 1
```

#### 3. IAM Roles for Service Accounts (IRSA)

1. **Create an IAM Role for IRSA with Prometheus Permissions**:
    - Attach a policy to the role that allows `aps:RemoteWrite`.
    - Create a trust relationship between the IAM role and the Kubernetes service account.

2. **Annotate the Kubernetes Service Account**:
    - Annotate the service account with the IAM role ARN.

3. **Update Prometheus Configuration**:
    - Edit the `prometheus.yml` file to include the remote write configuration with SigV4 authentication.

```yaml
remote_write:
- url: "https://aps-workspaces.<region>.amazonaws.com/workspaces/<workspace-id>/api/v1/remote_write"
  sigv4:
    region: <region>
  queue_config:
    capacity: 2500
    max_samples_per_send: 500
    max_shards: 200
    min_shards: 1
```

## Alertmanager Configuration

### Configuring Alertmanager with SNS

To configure Alertmanager to send alerts to SNS, you need to modify the `alertmanager.yml` file. Below are examples for configuring Alertmanager with different authentication methods: IAM role, IAM keys, and IRSA.

#### 1. IAM Role

1. **Create an IAM Role with SNS Permissions**:
    - Attach a policy to the role that allows `sns:Publish`.

2. **Attach the IAM Role to the EC2 Instance** running Alertmanager:
    - Ensure the instance profile is attached to the EC2 instance.

3. **Update Alertmanager Configuration**:
    - Edit the `alertmanager.yml` file to include the SNS configuration.

```yaml
global:
resolve_timeout: 5m

route:
receiver: 'sns'

receivers:
- name: 'sns'
  sns_configs:
  - sigv4:
      region: <region>
    topic_arn: <sns_topic_arn>
    subject: 'Prometheus Alert'
```

#### 2. IAM Keys

1. **Create an IAM User with SNS Permissions**:
    - Attach a policy to the user that allows `sns:Publish`.
    - Generate access keys for the user.

2. **Update Alertmanager Configuration**:
    - Edit the `alertmanager.yml` file to include the SNS configuration with basic authentication using the IAM keys.

```yaml
global:
resolve_timeout: 5m

route:
receiver: 'sns'

receivers:
- name: 'sns'
  sns_configs:
  - sigv4:
      access_key: <access_key_id>
      secret_key: <secret_access_key>
      region: <region>
    topic_arn: <sns_topic_arn>
subject: 'Prometheus Alert'
```

#### 3. IAM Roles for Service Accounts (IRSA)

1. **Create an IAM Role for IRSA with SNS Permissions**:
    - Attach a policy to the role that allows `sns:Publish`.
    - Create a trust relationship between the IAM role and the Kubernetes service account.

2. **Annotate the Kubernetes Service Account**:
    - Annotate the service account with the IAM role ARN.

3. **Update Alertmanager Configuration**:
    - Edit the `alertmanager.yml` file to include the SNS configuration.

```yaml
global:
resolve_timeout: 5m

route:
receiver: 'sns'

receivers:
- name: 'sns'
  sns_configs:
  - sigv4:
      region: <region>
    topic_arn: <sns_topic_arn>
    subject: 'Prometheus Alert'
```

### Additional Notes

- Replace `<region>`, `<workspace-id>`, `<sns_topic_arn>`, `<access_key_id>`, and `<secret_access_key>` with your actual values.
- Ensure Prometheus and Alertmanager have network access to the AWS Managed Prometheus and SNS endpoints.
- For detailed permissions and policies, refer to the [AWS documentation](https://docs.aws.amazon.com/).

This guide provides the basic steps to configure Prometheus and Alertmanager for remote write and alerting using AWS services. Adjust configurations as necessary to fit your specific use case and security requirements.
