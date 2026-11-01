$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$workerPath = Join-Path $PSScriptRoot 'worker.mjs'
Stop-ScheduledTask -TaskName 'Readwind catalog preparation' -ErrorAction SilentlyContinue
# Stop only the exact worker launched by this workspace's scheduled task.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($workerPath) -and $_.CommandLine -match '\bwatch\b' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
