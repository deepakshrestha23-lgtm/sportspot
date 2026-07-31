param(
    [string]$SecretKey
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $projectRoot "backend"
$envPath = Join-Path $backendPath ".env"

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "backend/.env was not found. Create it before configuring Khalti."
}

if (-not $SecretKey) {
    $secureSecret = Read-Host "Khalti sandbox live_secret_key (input is hidden)" -AsSecureString
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    try {
        $SecretKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
}

$SecretKey = $SecretKey.Trim()
if ($SecretKey.Length -lt 20) {
    throw "That does not look like a Khalti sandbox secret key. Copy the live_secret_key from the Khalti sandbox merchant dashboard."
}

$updates = [ordered]@{
    KHALTI_BASE_URL = "https://dev.khalti.com/api/v2"
    KHALTI_SECRET_KEY = $SecretKey
    KHALTI_WEBSITE_URL = "http://localhost:3000"
    KHALTI_RETURN_PATH = "/dashboard/player/bookings/payment/khalti-return"
}

$lines = [System.Collections.Generic.List[string]]::new()
Get-Content -LiteralPath $envPath | ForEach-Object { [void]$lines.Add($_) }

foreach ($entry in $updates.GetEnumerator()) {
    $prefix = "$($entry.Key)="
    $replacement = "$prefix$($entry.Value)"
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index].StartsWith($prefix, [StringComparison]::Ordinal)) {
            $lines[$index] = $replacement
            $found = $true
            break
        }
    }
    if (-not $found) {
        [void]$lines.Add($replacement)
    }
}

[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
$SecretKey = $null

Write-Host ""
Write-Host "Khalti sandbox settings saved to backend/.env." -ForegroundColor Green
Write-Host "Checking Django settings..." -ForegroundColor Cyan
Push-Location $backendPath
try {
    python manage.py check
} finally {
    Pop-Location
}
