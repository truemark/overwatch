Invoke-WebRequest -Uri {{ WindowsExporterPackageUrl }} -OutFile C:\\windows\\temp\\windows_exporter.msi
Start-Process msiexec.exe -ArgumentList '/i C:\\windows\\temp\\windows_exporter.msi  ENABLED_COLLECTORS=cpu,cpu_info,cs,logical_disk,net,os,physical_disk,system,memory,iis' -NoNewWindow -Wait
Remove-Item C:\\windows\\temp\\windows_exporter.msi
Stop-Service -Name windows_exporter -ErrorAction SilentlyContinue
sc.exe delete windows_exporter
$ErrorActionPreference = "Stop"
$commandLine ='"C:/Program Files/windows_exporter/windows_exporter.exe" --web.listen-address=:9182 --collectors.enabled=cpu,cpu_info,cs,logical_disk,net,os,physical_disk,system,memory,iis'
New-Service -Name 'windows_exporter' -BinaryPathName $commandLine -DisplayName 'Windows Exporter' -StartupType Automatic
Start-Service -Name "windows_exporter"
New-NetFirewallRule -DisplayName "Allow Node Exporter" -Direction Inbound -Protocol TCP -LocalPort 9182 -Action Allow
