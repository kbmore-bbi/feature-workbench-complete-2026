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
$ScriptPath = Join-Path $PSScriptRoot "bootstrap_sttm_metadata_infra.py"

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

try {
    & $PythonExe -c "import snowflake.connector"
} catch {
    & $PipExe install --upgrade snowflake-connector-python
}

Write-Host "Bootstrapping STTM metadata infra into $($cfg["SNOWFLAKE_DATABASE"]).$($cfg["SNOWFLAKE_SCHEMA"])"
$args = @(
    $ScriptPath,
    "--account", $cfg["SNOWFLAKE_ACCOUNT"],
    "--user", $cfg["SNOWFLAKE_USER"],
    "--database", $cfg["SNOWFLAKE_DATABASE"],
    "--schema", $cfg["SNOWFLAKE_SCHEMA"]
)

if ($cfg.ContainsKey("SNOWFLAKE_PASSWORD") -and $cfg["SNOWFLAKE_PASSWORD"]) {
    $args += @("--password", $cfg["SNOWFLAKE_PASSWORD"])
}
if ($cfg.ContainsKey("SNOWFLAKE_AUTHENTICATOR") -and $cfg["SNOWFLAKE_AUTHENTICATOR"]) {
    $args += @("--authenticator", $cfg["SNOWFLAKE_AUTHENTICATOR"])
}
if ($cfg.ContainsKey("SNOWFLAKE_HOST") -and $cfg["SNOWFLAKE_HOST"]) {
    $args += @("--host", $cfg["SNOWFLAKE_HOST"])
}
if ($cfg.ContainsKey("SNOWFLAKE_ROLE") -and $cfg["SNOWFLAKE_ROLE"]) {
    $args += @("--role", $cfg["SNOWFLAKE_ROLE"])
}
if ($cfg.ContainsKey("SNOWFLAKE_WAREHOUSE") -and $cfg["SNOWFLAKE_WAREHOUSE"]) {
    $args += @("--warehouse", $cfg["SNOWFLAKE_WAREHOUSE"])
}

& $PythonExe @args
