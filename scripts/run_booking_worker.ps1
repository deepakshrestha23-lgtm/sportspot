Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $repoRoot "backend"

Set-Location $backendPath
python manage.py run_booking_maintenance --watch --interval 10 --reminder-every 300
