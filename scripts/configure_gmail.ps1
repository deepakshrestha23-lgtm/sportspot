param(
    [string]$GmailAddress
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $projectRoot "backend"
$envPath = Join-Path $backendPath ".env"

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "backend/.env was not found. Create it before configuring email."
}

if (-not $GmailAddress) {
    $GmailAddress = Read-Host "Gmail address that SportSpot should send from"
}
$GmailAddress = $GmailAddress.Trim().ToLowerInvariant()
if ($GmailAddress -notmatch "^[^@\s]+@gmail\.com$") {
    throw "Enter a valid @gmail.com address."
}

$securePassword = Read-Host "Google 16-character App Password (input is hidden)" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $appPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
$appPassword = ($appPassword -replace "\s", "")
if ($appPassword.Length -ne 16) {
    throw "Google App Password must contain exactly 16 characters after spaces are removed."
}

$updates = [ordered]@{
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = "smtp.gmail.com"
    EMAIL_PORT = "587"
    EMAIL_HOST_USER = $GmailAddress
    EMAIL_HOST_PASSWORD = $appPassword
    EMAIL_USE_TLS = "True"
    EMAIL_USE_SSL = "False"
    EMAIL_TIMEOUT = "15"
    DEFAULT_FROM_EMAIL = "SportSpot <$GmailAddress>"
    SPORTSPOT_SUPPORT_EMAIL = $GmailAddress
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
$appPassword = $null

Write-Host ""
Write-Host "Gmail SMTP saved to backend/.env." -ForegroundColor Green
Write-Host "Sending a delivery test now..." -ForegroundColor Cyan
Push-Location $backendPath
try {
    python manage.py check_email_delivery --to $GmailAddress
} finally {
    Pop-Location
}
