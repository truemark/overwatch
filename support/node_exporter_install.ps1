Invoke-WebRequest -Uri {{ WindowsExporterPackageUrl }} -OutFile C:\\windows\\temp\\windows_exporter.msi
Start-Process msiexec.exe -ArgumentList '/i C:\\windows\\temp\\windows_exporter.msi /quiet' -NoNewWindow -Wait
Remove-Item C:\\windows\\temp\\windows_exporter.msi
Stop-Service -Name windows_exporter -ErrorAction SilentlyContinue
sc.exe delete windows_exporter
$ErrorActionPreference = "Stop"
$commandLine ='"C:/Program Files/windows_exporter/windows_exporter.exe" --web.listen-address=:9100'
New-Service -Name 'windows_exporter' -BinaryPathName $commandLine -DisplayName 'Windows Exporter' -StartupType Automatic
Start-Service -Name "windows_exporter"
New-NetFirewallRule -DisplayName "Allow Node Exporter" -Direction Inbound -Protocol TCP -LocalPort 9100 -Action Allow
