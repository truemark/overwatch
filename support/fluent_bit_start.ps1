# File: Start-FluentBit.ps1

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

# Get IMDSv2 token
$token = Get-IMDSToken

# Query the instance metadata
$instanceId = Get-Metadata -Uri "http://169.254.169.254/latest/meta-data/instance-id" -Token $token
$instanceType = Get-Metadata -Uri "http://169.254.169.254/latest/meta-data/instance-type" -Token $token
$availabilityZone = Get-Metadata -Uri "http://169.254.169.254/latest/meta-data/placement/availability-zone" -Token $token

# Set environment variables
[System.Environment]::SetEnvironmentVariable('INSTANCE_ID', $instanceId, [System.EnvironmentVariableTarget]::Process)
[System.Environment]::SetEnvironmentVariable('INSTANCE_TYPE', $instanceType, [System.EnvironmentVariableTarget]::Process)
[System.Environment]::SetEnvironmentVariable('AVAILABILITY_ZONE', $availabilityZone, [System.EnvironmentVariableTarget]::Process)

# Start Fluent Bit
Start-Process -FilePath "C:\Path\To\fluent-bit.exe" -ArgumentList "-c", "C:\Path\To\fluent-bit.conf"





