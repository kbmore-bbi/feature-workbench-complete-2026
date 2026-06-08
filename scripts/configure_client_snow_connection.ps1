param(
    [string]$EnvFile = "",
    [switch]$ForceRecreate
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) {
    $EnvFile = Join-Path $RootDir "infra\snowflake\env\client.env"
}

$ToolsVenv = Join-Path $RootDir ".client-tools-venv"

function Resolve-SnowCli {
    param([string]$VenvPath)

    $candidates = @(
        (Join-Path $VenvPath "Scripts\snow.exe"),
        (Join-Path $VenvPath "Scripts\snow.cmd"),
        (Join-Path $VenvPath "Scripts\snow")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Import-ClientEnv {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Env file not found: $Path"
    }

    $values = @{}
    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        $parts = $trimmed -split "=", 2
        if ($parts.Count -ne 2) {
            continue
        }
        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$key] = $value
    }
    return $values
}

if (-not (Resolve-SnowCli -VenvPath $ToolsVenv)) {
    Write-Host "Snow CLI tools are not bootstrapped yet. Running bootstrap script first."
    & (Join-Path $PSScriptRoot "bootstrap_client_spcs_tools.ps1")
}

$SnowExe = Resolve-SnowCli -VenvPath $ToolsVenv
if (-not $SnowExe) {
    throw "Snow CLI is still unavailable after bootstrap. Check .client-tools-venv\\Scripts for a runnable snow command."
}

$cfg = Import-ClientEnv -Path $EnvFile

$required = @(
    "SNOWFLAKE_CONNECTION",
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_USER",
    "SNOWFLAKE_ROLE",
    "SNOWFLAKE_WAREHOUSE",
    "SNOWFLAKE_DATABASE"
)

foreach ($name in $required) {
    if (-not $cfg.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($cfg[$name])) {
        throw "$name must be set in $EnvFile"
    }
}

$authenticator = if ($cfg.ContainsKey("SNOWFLAKE_AUTHENTICATOR") -and $cfg["SNOWFLAKE_AUTHENTICATOR"]) {
    $cfg["SNOWFLAKE_AUTHENTICATOR"]
} else {
    "externalbrowser"
}

try {
    & $SnowExe connection test -c $cfg["SNOWFLAKE_CONNECTION"] *> $null
    if ($LASTEXITCODE -eq 0 -and -not $ForceRecreate) {
        Write-Host "Snow connection '$($cfg["SNOWFLAKE_CONNECTION"])' already works. Reusing it."
        exit 0
    }
} catch {
}

if ($ForceRecreate) {
    try {
        & $SnowExe connection remove $cfg["SNOWFLAKE_CONNECTION"] --format TABLE
    } catch {
    }
} else {
    try {
        & $SnowExe connection remove $cfg["SNOWFLAKE_CONNECTION"] --format TABLE *> $null
    } catch {
    }
}

Write-Host "Creating Snow CLI connection '$($cfg["SNOWFLAKE_CONNECTION"])'"
& $SnowExe connection add `
    --connection-name $cfg["SNOWFLAKE_CONNECTION"] `
    --account $cfg["SNOWFLAKE_ACCOUNT"] `
    --user $cfg["SNOWFLAKE_USER"] `
    --role $cfg["SNOWFLAKE_ROLE"] `
    --warehouse $cfg["SNOWFLAKE_WAREHOUSE"] `
    --database $cfg["SNOWFLAKE_DATABASE"] `
    --authenticator $authenticator `
    --default `
    --format TABLE

Write-Host ""
Write-Host "Testing connection '$($cfg["SNOWFLAKE_CONNECTION"])'"
& $SnowExe connection test -c $cfg["SNOWFLAKE_CONNECTION"]
Write-Host ""
Write-Host "Connection configured successfully."
