Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$taskName = "SportSpot Platform Maintenance"
$runnerPath = Join-Path $PSScriptRoot "run_sportspot_maintenance_once.ps1"
$wrapperPath = Join-Path $PSScriptRoot "run_sportspot_maintenance_hidden.vbs"
$wscriptPath = Join-Path $env:WINDIR "System32\wscript.exe"

if (-not (Test-Path -LiteralPath $runnerPath)) {
    throw "Maintenance runner was not found: $runnerPath"
}

if (-not (Test-Path -LiteralPath $wrapperPath)) {
    throw "Windowless maintenance wrapper was not found: $wrapperPath"
}

if (-not (Test-Path -LiteralPath $wscriptPath)) {
    throw "Windows Script Host was not found: $wscriptPath"
}

$arguments = "//NoLogo `"$wrapperPath`""
$action = New-ScheduledTaskAction -Execute $wscriptPath -Argument $arguments
$startAt = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet `
    -Hidden `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Runs SportSpot booking and matchmaking lifecycle maintenance." `
    -Force | Out-Null

Write-Host "Registered '$taskName'. It will run every minute while this computer is available."
Write-Host "The first run is scheduled for $startAt."
