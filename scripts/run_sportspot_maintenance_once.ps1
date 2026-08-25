Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $repoRoot "backend"
$pythonPath = Join-Path $backendPath ".venv\Scripts\python.exe"
$logDirectory = Join-Path $repoRoot ".logs"
$logPath = Join-Path $logDirectory "sportspot-maintenance.log"

if (-not (Test-Path -LiteralPath $pythonPath)) {
    $pythonPath = "python"
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$startedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
try {
    Push-Location $backendPath
    $output = & $pythonPath manage.py run_sportspot_maintenance --limit 100 2>&1
    $exitCode = $LASTEXITCODE
    $output | Tee-Object -FilePath $logPath -Append
    if ($exitCode -ne 0) {
        throw "Maintenance exited with code $exitCode."
    }
}
catch {
    $message = "[$startedAt] SportSpot maintenance failed: $($_.Exception.Message)"
    Add-Content -LiteralPath $logPath -Value $message
    Write-Error $message
    exit 1
}
finally {
    Pop-Location
}
