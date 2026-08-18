Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $repoRoot "backend"

Set-Location $backendPath
$pythonPath = Join-Path $backendPath ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonPath)) {
    $pythonPath = "python"
}
& $pythonPath manage.py run_sportspot_maintenance --watch --interval 10 --reminder-every 300
