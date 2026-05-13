param(
    [string]$PythonExe = "",
    [string]$SnowflakeCliVersion = ""
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$ToolsVenv = Join-Path $RootDir ".client-tools-venv"

function Resolve-Python {
    param([string]$Preferred)

    if ($Preferred) {
        if (Test-Path $Preferred) {
            return $Preferred
        }
        $preferredCommand = Get-Command $Preferred -ErrorAction SilentlyContinue
        if ($preferredCommand) {
            return $preferredCommand.Source
        }
    }

    $candidates = @(
        "python",
        "python3"
    )

    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }

    throw "Python 3 is required but was not found in PATH."
}

$PythonCmd = Resolve-Python -Preferred $PythonExe

$versionCheck = @'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("Python 3.10+ is required for the client deployment tools.")
'@

$versionCheck | & $PythonCmd -

if (-not (Test-Path $ToolsVenv)) {
    Write-Host "Creating tools virtualenv at $ToolsVenv"
    & $PythonCmd -m venv $ToolsVenv
} else {
    Write-Host "Reusing tools virtualenv at $ToolsVenv"
}

$PythonExe = Join-Path $ToolsVenv "Scripts\python.exe"
$SnowExe = Join-Path $ToolsVenv "Scripts\snow.exe"

Write-Host "Upgrading pip tooling"
& $PythonExe -m pip install --upgrade pip setuptools wheel

if ($SnowflakeCliVersion) {
    Write-Host "Installing snowflake-cli==$SnowflakeCliVersion"
    & $PythonExe -m pip install --upgrade "snowflake-cli==$SnowflakeCliVersion"
} else {
    Write-Host "Installing latest snowflake-cli"
    & $PythonExe -m pip install --upgrade snowflake-cli
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required but was not found in PATH."
}

Write-Host ""
Write-Host "Snow CLI installed successfully."
Write-Host "Snow binary: $SnowExe"
& $SnowExe --version
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Copy infra/snowflake/env/client.env.example to infra/snowflake/env/client.env"
Write-Host "  2. Fill the client-specific values in that env file"
Write-Host "  3. Run .\scripts\configure_client_snow_connection.ps1"
Write-Host "  4. Run .\scripts\deploy_spcs_client_snow.ps1"
