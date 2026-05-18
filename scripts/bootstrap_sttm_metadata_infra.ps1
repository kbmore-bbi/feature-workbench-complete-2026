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
& $PythonExe $ScriptPath `
    --account $cfg["SNOWFLAKE_ACCOUNT"] `
    --user $cfg["SNOWFLAKE_USER"] `
    --password $(if ($cfg.ContainsKey("SNOWFLAKE_PASSWORD")) { $cfg["SNOWFLAKE_PASSWORD"] } else { "" }) `
    --authenticator $(if ($cfg.ContainsKey("SNOWFLAKE_AUTHENTICATOR")) { $cfg["SNOWFLAKE_AUTHENTICATOR"] } else { "" }) `
    --host $(if ($cfg.ContainsKey("SNOWFLAKE_HOST")) { $cfg["SNOWFLAKE_HOST"] } else { "" }) `
    --role $(if ($cfg.ContainsKey("SNOWFLAKE_ROLE")) { $cfg["SNOWFLAKE_ROLE"] } else { "" }) `
    --warehouse $(if ($cfg.ContainsKey("SNOWFLAKE_WAREHOUSE")) { $cfg["SNOWFLAKE_WAREHOUSE"] } else { "" }) `
    --database $cfg["SNOWFLAKE_DATABASE"] `
    --schema $cfg["SNOWFLAKE_SCHEMA"]
