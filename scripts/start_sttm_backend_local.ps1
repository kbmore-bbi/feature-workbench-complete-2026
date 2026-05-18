param(
    [string]$HostAddress = "0.0.0.0",
    [int]$Port = 8000,
    [switch]$NoReload
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$ServiceDir = Join-Path $RootDir "services\sttm-builder"
$VenvDir = Join-Path $ServiceDir ".venv"
$EnvFile = Join-Path $ServiceDir ".env.local"
$EnvExample = Join-Path $ServiceDir ".env.example"

function Log-Info {
    param([string]$Message)
    Write-Host "[sttm-backend] $Message"
}

function Fail {
    param([string]$Message)
    throw "[sttm-backend] ERROR: $Message"
}

function Resolve-VenvPython {
    $candidates = @(
        (Join-Path $VenvDir "Scripts\python.exe"),
        (Join-Path $VenvDir "Scripts\python"),
        (Join-Path $VenvDir "bin\python")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Resolve-BootstrapPython {
    $candidates = @("python", "python3")
    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }

    Fail "Python 3 is required but was not found."
}

function Import-EnvFile {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return @{}
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

function Sync-EnvFile {
    if (-not (Test-Path $EnvExample)) {
        Fail "Could not find $EnvExample"
    }

    if (-not (Test-Path $EnvFile)) {
        Copy-Item $EnvExample $EnvFile
        Log-Info "Created $EnvFile from .env.example"
        Log-Info "Update the Snowflake values in $EnvFile before using authenticated endpoints."
        return
    }

    $existing = Import-EnvFile -Path $EnvFile
    $missing = @()

    foreach ($line in Get-Content $EnvExample) {
        if ($line -notmatch '^[A-Z0-9_]+=') {
            continue
        }
        $key = ($line -split '=', 2)[0].Trim()
        if (-not $existing.ContainsKey($key)) {
            $missing += $line
        }
    }

    if ($missing.Count -eq 0) {
        return
    }

    Add-Content -Path $EnvFile -Value ""
    Add-Content -Path $EnvFile -Value "# Added from .env.example by start_sttm_backend_local.ps1"
    foreach ($line in $missing) {
        Add-Content -Path $EnvFile -Value $line
    }

    Log-Info "Updated $EnvFile with missing keys from .env.example"
}

function Validate-LocalAuthConfig {
    $envValues = Import-EnvFile -Path $EnvFile
    $enabled = ""
    if ($envValues.ContainsKey("LOCAL_DEV_AUTH_ENABLED") -and $null -ne $envValues["LOCAL_DEV_AUTH_ENABLED"]) {
        $enabled = [string]$envValues["LOCAL_DEV_AUTH_ENABLED"]
    }
    $enabled = $enabled.ToLowerInvariant()
    if ($enabled -ne "true") {
        Fail "LOCAL_DEV_AUTH_ENABLED is not set to true in $EnvFile. Local STTM auth will fail without Snowflake ingress headers."
    }

    $required = @("SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_WAREHOUSE")
    $authenticator = ""
    if ($envValues.ContainsKey("SNOWFLAKE_AUTHENTICATOR") -and $null -ne $envValues["SNOWFLAKE_AUTHENTICATOR"]) {
        $authenticator = [string]$envValues["SNOWFLAKE_AUTHENTICATOR"]
    }
    $authenticator = $authenticator.ToLowerInvariant()
    if ($authenticator -ne "externalbrowser") {
        $required += "SNOWFLAKE_PASSWORD"
    }

    $missing = @()
    foreach ($name in $required) {
        if (-not $envValues.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($envValues[$name])) {
            $missing += $name
        }
    }

    if ($missing.Count -gt 0) {
        Fail ("Missing required local Snowflake settings in {0}: {1}" -f $EnvFile, ($missing -join ', '))
    }
}

function Ensure-Venv {
    $venvPython = Resolve-VenvPython
    if ($venvPython) {
        return $venvPython
    }

    $bootstrapPython = Resolve-BootstrapPython
    Log-Info "Creating virtual environment at $VenvDir"
    & $bootstrapPython -m venv $VenvDir

    $venvPython = Resolve-VenvPython
    if (-not $venvPython) {
        Fail "Virtual environment Python was not found after creation."
    }
    return $venvPython
}

function Ensure-Dependencies {
    param([string]$PythonExe)

    $probe = @'
import fastapi  # noqa: F401
import uvicorn  # noqa: F401
import httpx  # noqa: F401
import pydantic  # noqa: F401
import pydantic_settings  # noqa: F401
import swagger_ui_bundle  # noqa: F401
import snowflake.connector  # noqa: F401
import snowflake.snowpark  # noqa: F401
'@

    try {
        $probe | & $PythonExe - 2>$null
        if ($LASTEXITCODE -eq 0) {
            Log-Info "Backend dependencies already available in $VenvDir"
            return
        }
    } catch {
    }

    Log-Info "Installing backend dependencies"
    & $PythonExe -m pip install --upgrade pip
    & $PythonExe -m pip install -e $ServiceDir
}

Sync-EnvFile
Validate-LocalAuthConfig
$PythonExe = Ensure-Venv
Ensure-Dependencies -PythonExe $PythonExe

$reloadArgs = @()
if (-not $NoReload) {
    $reloadArgs += "--reload"
}

Log-Info "Starting STTM backend on http://127.0.0.1:$Port"
Log-Info "Health check: http://127.0.0.1:$Port/health"
Log-Info "Docs: http://127.0.0.1:$Port/docs"
Log-Info "Local note: Snowflake ingress auth headers are not present on localhost."
Log-Info "For local frontend/API testing, set LOCAL_DEV_AUTH_ENABLED=true in $EnvFile"
Log-Info "and provide either SNOWFLAKE_USER / SNOWFLAKE_PASSWORD"
Log-Info "or SNOWFLAKE_USER with SNOWFLAKE_AUTHENTICATOR=externalbrowser"

Push-Location $ServiceDir
try {
    $env:APP_ENV = if ($env:APP_ENV) { $env:APP_ENV } else { "local" }
    $env:APP_NAME = if ($env:APP_NAME) { $env:APP_NAME } else { "BBI AI Migration Workbench API" }
    $env:APP_VERSION = if ($env:APP_VERSION) { $env:APP_VERSION } else { "local" }
    $env:PORT = "$Port"
    & $PythonExe -m uvicorn app.main:app --host $HostAddress --port $Port @reloadArgs
}
finally {
    Pop-Location
}
