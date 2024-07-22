
Invoke-WebRequest -Uri {{ Windows64FluentbitPackageUrl }} -OutFile C:\\windows\\temp\\fluentbit.exe
Start-Process -FilePath "C:\Windows\Temp\fluentbit.exe" -ArgumentList "/S" -NoNewWindow -Wait
Remove-Item C:\\windows\\temp\\fluentbit.exe
Stop-Service -Name fluentbit -ErrorAction SilentlyContinue
sc.exe delete fluent-bit
$ErrorActionPreference = "Stop"


Set-Content -Path "C:\\Program Files\\fluent-bit\\bin\\Start-FluentBit.ps1" -Value @'
function Get-IMDSToken {
    $token = Invoke-RestMethod -Method PUT -Uri http://169.254.169.254/latest/api/token -Headers @{"X-aws-ec2-metadata-token-ttl-seconds"="21600"}
    return $token
}

function Get-Metadata {
    param (
        [string]$Uri,
        [string]$Token
    )
    $headers = @{"X-aws-ec2-metadata-token" = $Token}
    try {
        $response = Invoke-RestMethod -Uri $Uri -Headers $headers
        return $response
    } catch {
        Write-Error "Failed to get metadata from $Uri"
        throw $_
    }
}

$token = Get-IMDSToken

$instanceId = Get-Metadata -Uri "http://169.254.169.254/latest/meta-data/instance-id" -Token $token
$instancePrivateIp = Get-Metadata -Uri "http://169.254.169.254/latest/meta-data/local-ipv4" -Token $token
$instanceHostname = Get-Metadata -Uri "http://169.254.169.254/latest/meta-data/local-hostname" -Token $token

[System.Environment]::SetEnvironmentVariable('INSTANCE_ID', $instanceId, [System.EnvironmentVariableTarget]::Process)
[System.Environment]::SetEnvironmentVariable('INSTANCE_PRIVATE_IP', $instancePrivateIp, [System.EnvironmentVariableTarget]::Process)
[System.Environment]::SetEnvironmentVariable('INSTANCE_LOCAL_HOSTNAME', $instanceHostname, [System.EnvironmentVariableTarget]::Process)

Start-Process -FilePath "C:\\Program Files\\fluent-bit\\bin\\fluent-bit.exe" -ArgumentList "-c", "../conf/fluent-bit.conf" -NoNewWindow -Wait
'@
Set-Content -Path "C:\\Program Files\\fluent-bit\\conf\\fluent-bit.conf" -Value @'
[SERVICE]
    # Flush interval seconds
    flush        60

    # Daemon
    daemon       Off

    # Log_Level error warning info debug trace
    log_level    info

    # Parsers File
    parsers_file parsers.conf

    # Plugins File
    plugins_file plugins.conf

    # HTTP Server
    # ===========
    # Enable/Disable the built-in HTTP Server for metrics
    http_server  Off
    http_listen  0.0.0.0
    http_port    2020
[INPUT]
    name prometheus_scrape
    host localhost
    port 9182
    tag node_metrics
    metrics_path /metrics?format=prometheus
    scrape_interval 60s
[OUTPUT]
    Name                prometheus_remote_write
    Match               node_metrics
    Host                {{ PrometheusHostname }}
    Port                443
    URI                 /workspaces/{{ PrometheusWorkspace }}/api/v1/remote_write
    #URI                 {{ PrometheusWorkspace }}
    Retry_Limit         False
    tls                 On
    tls.verify          On
    Add_label           host ${HOSTNAME}
    Add_label           instanceId  ${INSTANCE_ID}
    Add_label           private_ip ${INSTANCE_PRIVATE_IP}
    Add_label           local_hostname ${INSTANCE_LOCAL_HOSTNAME}
    # AWS credentials
    aws_auth            on
    aws_region          {{ Region }}
'@

Set-Content -Path "C:\\Program Files\\fluent-bit\\bin\\fluent-bit.bat" -Value @'
echo off
powershell.exe -File "C:\Program Files\fluent-bit\bin\Start-FluentBit.ps1"
'@

$commandLine ='"C:\Program Files\fluent-bit\bin\fluent-bit.bat"  '
New-Service -Name 'fluent-bit' -BinaryPathName $commandLine -DisplayName 'Fluent Bit' -StartupType Automatic
#Start-Service -Name "fluent-bit"
