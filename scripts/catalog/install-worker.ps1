param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = 'Readwind catalog preparation'
if ($Remove) { & (Join-Path $PSScriptRoot 'stop-worker.ps1'); Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue; exit }
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runnerPath = Join-Path $PSScriptRoot 'run-worker.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`"" -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Prepare queued Readwind books locally; online publication requires verified storage configuration.' | Out-Null
Write-Output 'Readwind preparation task installed. It starts at your next login. Use start-worker.ps1 to start now.'
