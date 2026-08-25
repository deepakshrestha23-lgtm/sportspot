Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$taskName = "SportSpot Platform Maintenance"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if (-not $task) {
    Write-Host "The SportSpot maintenance task is not registered."
    exit 0
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Removed '$taskName'."
