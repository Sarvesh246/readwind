$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $projectRoot
& (Get-Command node -ErrorAction Stop).Source --env-file-if-exists=.env.local (Join-Path $PSScriptRoot 'worker.mjs') watch
exit $LASTEXITCODE
