$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot "backend\.env"

if (-not (Test-Path -LiteralPath $envPath)) {
    Write-Host "Could not find backend\.env at: $envPath" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host ""
Write-Host "SportSpot Gmail App Password Setup" -ForegroundColor Green
Write-Host "Paste the 16-character Gmail App Password for officialsportspot@gmail.com." -ForegroundColor White
Write-Host "It may look like: abcd efgh ijkl mnop. Spaces will be removed automatically." -ForegroundColor DarkGray
Write-Host ""

$securePassword = Read-Host "Gmail App Password" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
}

$appPassword = ($plainPassword -replace "\s", "")

if ($appPassword.Length -ne 16) {
    Write-Host ""
    Write-Host "That does not look like a 16-character Gmail App Password after removing spaces." -ForegroundColor Red
    Write-Host "Please generate the App Password from Google Account > Security > App passwords." -ForegroundColor Yellow
    Read-Host "Press Enter to close"
    exit 1
}

$lines = Get-Content -LiteralPath $envPath
$updated = $false
$nextLines = foreach ($line in $lines) {
    if ($line -match "^EMAIL_HOST_PASSWORD=") {
        $updated = $true
        "EMAIL_HOST_PASSWORD=$appPassword"
    }
    else {
        $line
    }
}

if (-not $updated) {
    $nextLines += "EMAIL_HOST_PASSWORD=$appPassword"
}

Set-Content -LiteralPath $envPath -Value $nextLines

Write-Host ""
Write-Host "Done. Gmail App Password saved to backend\.env." -ForegroundColor Green
Write-Host "Now restart Django: cd backend; python manage.py runserver" -ForegroundColor White
Read-Host "Press Enter to close"
