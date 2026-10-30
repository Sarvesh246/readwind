$ErrorActionPreference = 'Stop'
# Restrict ignored local credentials to this Windows identity and SYSTEM.
$readwindOwnerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$readwindRoot = Split-Path -Parent $PSScriptRoot
foreach ($relative in @('.env.local', '.dev.vars', 'work/qa-account.json')) {
    $target = Join-Path $readwindRoot $relative
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        & icacls $target /inheritance:r /grant:r "*$($readwindOwnerSid):(F)" '*S-1-5-18:(F)' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not restrict $relative" }
        Write-Output "Restricted access to $relative"
    }
}
