param(
    [string]$EnvironmentName = "sportspot-api-production",
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

function Read-DotEnvFile([string]$Path) {
    $values = @{}
    Get-Content -LiteralPath $Path | ForEach-Object {
        if ($_ -match "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$") {
            $value = $matches[2]
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $values[$matches[1]] = $value
        }
    }
    return $values
}

$root = Split-Path -Parent $PSScriptRoot
$local = Read-DotEnvFile (Join-Path $root "backend\.env")
$required = @(
    "EMAIL_BACKEND", "EMAIL_HOST", "EMAIL_PORT", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD",
    "EMAIL_USE_TLS", "EMAIL_USE_SSL", "EMAIL_TIMEOUT", "DEFAULT_FROM_EMAIL",
    "SPORTSPOT_SUPPORT_EMAIL", "KHALTI_BASE_URL", "KHALTI_SECRET_KEY", "KHALTI_RETURN_PATH"
)
$missing = $required | Where-Object { -not $local.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($local[$_]) }
if ($missing) {
    throw "Missing required local settings: $($missing -join ', ')"
}

$account = aws sts get-caller-identity --query Account --output text --region $Region
$parameterPrefix = "/sportspot/production"
$emailPasswordParameter = "$parameterPrefix/email-host-password"
$khaltiSecretParameter = "$parameterPrefix/khalti-secret-key"

aws ssm put-parameter --name $emailPasswordParameter --type SecureString --value $local["EMAIL_HOST_PASSWORD"] --overwrite --region $Region | Out-Null
aws ssm put-parameter --name $khaltiSecretParameter --type SecureString --value $local["KHALTI_SECRET_KEY"] --overwrite --region $Region | Out-Null

$settings = @(
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "EMAIL_BACKEND"; Value = $local["EMAIL_BACKEND"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "EMAIL_HOST"; Value = $local["EMAIL_HOST"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "EMAIL_PORT"; Value = $local["EMAIL_PORT"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "EMAIL_HOST_USER"; Value = $local["EMAIL_HOST_USER"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "EMAIL_USE_TLS"; Value = $local["EMAIL_USE_TLS"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "EMAIL_USE_SSL"; Value = $local["EMAIL_USE_SSL"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "EMAIL_TIMEOUT"; Value = $local["EMAIL_TIMEOUT"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "DEFAULT_FROM_EMAIL"; Value = $local["DEFAULT_FROM_EMAIL"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "SPORTSPOT_SUPPORT_EMAIL"; Value = $local["SPORTSPOT_SUPPORT_EMAIL"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "KHALTI_BASE_URL"; Value = $local["KHALTI_BASE_URL"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environment"; OptionName = "KHALTI_RETURN_PATH"; Value = $local["KHALTI_RETURN_PATH"] },
    @{ Namespace = "aws:elasticbeanstalk:application:environmentsecrets"; OptionName = "EMAIL_HOST_PASSWORD"; Value = "arn:aws:ssm:$Region`:$account`:parameter$emailPasswordParameter" },
    @{ Namespace = "aws:elasticbeanstalk:application:environmentsecrets"; OptionName = "KHALTI_SECRET_KEY"; Value = "arn:aws:ssm:$Region`:$account`:parameter$khaltiSecretParameter" }
)

# Use a temporary JSON argument so commas and special characters in provider
# configuration never get misparsed by the AWS CLI.
$optionsFile = Join-Path $env:TEMP "sportspot-service-settings.json"
$settings | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $optionsFile -NoNewline
try {
    aws elasticbeanstalk update-environment --environment-name $EnvironmentName --option-settings "file://$optionsFile" --region $Region | Out-Null
}
finally {
    Remove-Item -LiteralPath $optionsFile -Force -ErrorAction SilentlyContinue
}

Write-Output "Encrypted SMTP and Khalti settings queued for $EnvironmentName."
