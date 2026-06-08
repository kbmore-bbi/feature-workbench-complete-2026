param(
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) {
    $EnvFile = Join-Path $RootDir "infra\snowflake\env\client.env"
}

$ToolsVenv = Join-Path $RootDir ".client-tools-venv"
$PythonExe = Join-Path $ToolsVenv "Scripts\python.exe"
$PipExe = Join-Path $ToolsVenv "Scripts\pip.exe"
$ScriptPath = Join-Path $PSScriptRoot "bootstrap_dbt_repo_infra.py"

function Import-EnvFile {
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

if (-not (Test-Path $PythonExe)) {
    Write-Host "Client tools virtualenv is not bootstrapped yet. Running bootstrap script first."
    & (Join-Path $PSScriptRoot "bootstrap_client_spcs_tools.ps1")
}

$cfg = Import-EnvFile -Path $EnvFile

if (-not $cfg.ContainsKey("SNOWFLAKE_DBT_GIT_ORIGIN") -or [string]::IsNullOrWhiteSpace($cfg["SNOWFLAKE_DBT_GIT_ORIGIN"])) {
    Write-Host "Skipping DBT repo bootstrap because SNOWFLAKE_DBT_GIT_ORIGIN is not configured in $EnvFile"
    exit 0
}

try {
    & $PythonExe -c "import snowflake.connector"
} catch {
    & $PipExe install --upgrade snowflake-connector-python
}

Write-Host "Bootstrapping DBT repo infra into $($cfg["SNOWFLAKE_DATABASE"]).$($cfg["SNOWFLAKE_SCHEMA"])"
$args = @(
    $ScriptPath,
    "--account", $cfg["SNOWFLAKE_ACCOUNT"],
    "--user", $cfg["SNOWFLAKE_USER"],
    "--database", $cfg["SNOWFLAKE_DATABASE"],
    "--schema", $cfg["SNOWFLAKE_SCHEMA"]
)

foreach ($name in @(
    "SNOWFLAKE_PASSWORD",
    "SNOWFLAKE_AUTHENTICATOR",
    "SNOWFLAKE_HOST",
    "SNOWFLAKE_ROLE",
    "SNOWFLAKE_WAREHOUSE"
)) {
    if ($cfg.ContainsKey($name) -and $cfg[$name]) {
        $flag = "--" + $name.ToLowerInvariant().Replace("snowflake_", "").Replace("_", "-")
        $args += @($flag, $cfg[$name])
    }
}

foreach ($mapping in @(
    @{ Key = "SNOWFLAKE_DBT_GIT_API_INTEGRATION"; Flag = "--api-integration" },
    @{ Key = "SNOWFLAKE_DBT_GIT_ALLOWED_PREFIX"; Flag = "--allowed-prefix" },
    @{ Key = "SNOWFLAKE_DBT_GIT_SECRET_NAME"; Flag = "--secret-name" },
    @{ Key = "SNOWFLAKE_DBT_GIT_USERNAME"; Flag = "--git-username" },
    @{ Key = "SNOWFLAKE_DBT_GIT_PAT"; Flag = "--git-pat" },
    @{ Key = "SNOWFLAKE_DBT_GIT_REPOSITORY_NAME"; Flag = "--repository-name" },
    @{ Key = "SNOWFLAKE_DBT_GIT_ORIGIN"; Flag = "--repository-origin" },
    @{ Key = "SNOWFLAKE_DBT_GIT_CONSUMER_ROLE"; Flag = "--consumer-role" }
)) {
    if ($cfg.ContainsKey($mapping.Key) -and $cfg[$mapping.Key]) {
        $args += @($mapping.Flag, $cfg[$mapping.Key])
    }
}

& $PythonExe @args
