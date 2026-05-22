# ============================================================
# start-ai-workbench-dev.ps1
# Windows PowerShell equivalent of start-ai-workbench-dev.sh
# ============================================================

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"  # suppress progress bars in CI/logs

$ROOT_DIR      = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BACKEND_PORT  = if ($env:BACKEND_PORT)  { $env:BACKEND_PORT }  else { "8000" }
$FRONTEND_PORT = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "3000" }
$BACKEND_DEV_ORIGIN = if ($env:BACKEND_DEV_ORIGIN) { $env:BACKEND_DEV_ORIGIN } else { "http://127.0.0.1:$BACKEND_PORT" }

$BACKEND_SERVICE_DIR = Join-Path $ROOT_DIR "services\sttm-builder"
$VENV_DIR            = Join-Path $BACKEND_SERVICE_DIR ".venv"
$ENV_FILE            = Join-Path $BACKEND_SERVICE_DIR ".env.local"
$ENV_EXAMPLE         = Join-Path $BACKEND_SERVICE_DIR ".env.example"
$FRONTEND_DIR        = Join-Path $ROOT_DIR "frontend"

# ── helpers ──────────────────────────────────────────────────
function Log-Backend($msg)  { Write-Host "[sttm-backend] $msg" -ForegroundColor Cyan }
function Log-Frontend($msg) { Write-Host "[frontend]     $msg" -ForegroundColor Green }
function Die($msg)          { Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

# ── find python ──────────────────────────────────────────────
function Find-Python {
    $venvPy = Join-Path $VENV_DIR "Scripts\python.exe"
    if (Test-Path $venvPy) { return $venvPy }

    foreach ($cmd in @("python", "python3", "py")) {
        $found = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($found) {
            # Skip the Windows Store stub (lives under WindowsApps)
            if ($found.Source -like "*WindowsApps*") { continue }
            return $found.Source
        }
    }
    return $null
}

# ── ensure .env.local ────────────────────────────────────────
function Ensure-EnvFile {
    if (-not (Test-Path $ENV_FILE)) {
        if (-not (Test-Path $ENV_EXAMPLE)) { Die "Could not find $ENV_EXAMPLE" }
        Copy-Item $ENV_EXAMPLE $ENV_FILE
        Log-Backend "Created $ENV_FILE from .env.example"
        Log-Backend "Update the Snowflake values in $ENV_FILE before using authenticated endpoints."
    } else {
        # Sync missing keys from .env.example into .env.local
        $existingKeys = (Get-Content $ENV_FILE) |
            Where-Object { $_ -match '^[A-Z0-9_]+=' } |
            ForEach-Object { ($_ -split '=')[0] }

        $additions = (Get-Content $ENV_EXAMPLE) |
            Where-Object { $_ -match '^[A-Z0-9_]+=' } |
            Where-Object { ($_ -split '=')[0] -notin $existingKeys }

        if ($additions) {
            Add-Content $ENV_FILE "`n# Added from .env.example by start-ai-workbench-dev.ps1"
            $additions | Add-Content $ENV_FILE
            Log-Backend "Updated $ENV_FILE with missing keys from .env.example"
        }
    }
}

# ── ensure venv ──────────────────────────────────────────────
function Ensure-Venv {
    $venvPy = Join-Path $VENV_DIR "Scripts\python.exe"
    if (Test-Path $venvPy) { return }

    $bootstrapPy = Find-Python
    if (-not $bootstrapPy) { Die "Python 3 is required but was not found. Install from https://www.python.org/downloads/" }

    Log-Backend "Creating virtual environment at $VENV_DIR"
    & $bootstrapPy -m venv $VENV_DIR
}

# ── install deps ─────────────────────────────────────────────
function Install-BackendDeps {
    $venvPy = Join-Path $VENV_DIR "Scripts\python.exe"
    $checkScript = "import fastapi, uvicorn, httpx, pydantic, pydantic_settings"
    $depsOk = $false
    try {
        $null = & $venvPy -c $checkScript 2>&1
        if ($LASTEXITCODE -eq 0) { $depsOk = $true }
    } catch { $depsOk = $false }

    if ($depsOk) {
        Log-Backend "Backend dependencies already available in $VENV_DIR"
        return
    }
    Log-Backend "Installing backend dependencies (this may take a few minutes)..."
    & $venvPy -m pip install --upgrade pip --quiet
    & $venvPy -m pip install -e $BACKEND_SERVICE_DIR
    if ($LASTEXITCODE -ne 0) { Die "pip install failed. Check the output above." }
}

# ── install frontend deps ─────────────────────────────────────
function Ensure-FrontendDeps {
    $nodeModules = Join-Path $FRONTEND_DIR "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Log-Frontend "Installing frontend dependencies..."
        Push-Location $FRONTEND_DIR
        npm install
        Pop-Location
    }
}

# ── start backend ─────────────────────────────────────────────
function Start-Backend {
    $venvPy = Join-Path $VENV_DIR "Scripts\python.exe"
    Log-Backend "Starting STTM backend on http://127.0.0.1:$BACKEND_PORT"
    Log-Backend "Health check : http://127.0.0.1:$BACKEND_PORT/health"
    Log-Backend "Docs         : http://127.0.0.1:$BACKEND_PORT/docs"
    Log-Backend "For local dev auth set LOCAL_DEV_AUTH_ENABLED=true in $ENV_FILE"

    $env:APP_ENV   = "local"
    $env:APP_NAME  = "BBI AI Migration Workbench API"
    $env:APP_VERSION = "0.1.0"
    $env:PORT      = $BACKEND_PORT
    $env:CORS_ALLOWED_ORIGINS = "http://127.0.0.1:$FRONTEND_PORT,http://localhost:$FRONTEND_PORT,http://127.0.0.1:8080,http://localhost:8080"

    $backendJob = Start-Job -ScriptBlock {
        param($serviceDir, $venvPy, $port)
        Set-Location $serviceDir
        & $venvPy -m uvicorn app.main:app --host 0.0.0.0 --port $port --reload
    } -ArgumentList $BACKEND_SERVICE_DIR, $venvPy, $BACKEND_PORT

    return $backendJob
}

# ── start frontend ────────────────────────────────────────────
# Notes for Windows:
#   - Next.js 16 enables Turbopack by default. On low-RAM / Windows hosts the
#     Turbopack Rust binary can panic with "Out of memory: HashMap::Initialize"
#     which cascades into "Insufficient system resources (os error 1450)" and
#     "bash: fork: Resource temporarily unavailable". The `npm run dev` script
#     in frontend/package.json now passes `--webpack` to avoid that.
#   - We also raise Node's V8 heap via NODE_OPTIONS so HMR rebuilds have head room.
#   - To opt back in to Turbopack (if you have plenty of RAM) run
#     `npm run dev:turbo` directly from the frontend folder.
function Start-Frontend {
    Log-Frontend "Starting frontend on http://127.0.0.1:$FRONTEND_PORT"
    Log-Frontend "Using Webpack bundler (Turbopack disabled on Windows to avoid OOM)."

    $frontendJob = Start-Job -ScriptBlock {
        param($frontendDir, $port, $backendOrigin)
        Set-Location $frontendDir
        $env:PORT                    = $port
        $env:BACKEND_DEV_ORIGIN      = $backendOrigin
        $env:NEXT_PUBLIC_APP_ENV     = "local"
        $env:NEXT_TELEMETRY_DISABLED = "1"
        # Give Node enough heap for Webpack HMR rebuilds on Windows.
        if (-not $env:NODE_OPTIONS) {
            $env:NODE_OPTIONS = "--max-old-space-size=4096"
        }
        npm run dev
    } -ArgumentList $FRONTEND_DIR, $FRONTEND_PORT, $BACKEND_DEV_ORIGIN

    return $frontendJob
}

# ── main ──────────────────────────────────────────────────────
Write-Host "============================================" -ForegroundColor Yellow
Write-Host "  BBI AI Migration Workbench - Dev Server  " -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Yellow

Ensure-EnvFile
Ensure-Venv
Install-BackendDeps
Ensure-FrontendDeps

$backendJob  = Start-Backend
$frontendJob = Start-Frontend

Write-Host ""
Write-Host "Both servers are starting. Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host "  Backend  -> http://127.0.0.1:$BACKEND_PORT" -ForegroundColor Cyan
Write-Host "  Frontend -> http://127.0.0.1:$FRONTEND_PORT" -ForegroundColor Green
Write-Host ""

try {
    while ($true) {
        # Stream output from both jobs — use Continue so INFO/stderr lines don't crash the loop
        $ErrorActionPreference = "Continue"
        Receive-Job $backendJob  -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "[sttm-backend] $_" -ForegroundColor Cyan }
        Receive-Job $frontendJob -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "[frontend]     $_" -ForegroundColor Green }
        $ErrorActionPreference = "Stop"

        # Exit if either job died unexpectedly
        if ($backendJob.State  -eq "Failed") { Write-Host "[ERROR] Backend job failed."  -ForegroundColor Red; break }
        if ($frontendJob.State -eq "Failed") { Write-Host "[ERROR] Frontend job failed." -ForegroundColor Red; break }

        Start-Sleep -Milliseconds 500
    }
} finally {
    $ErrorActionPreference = "Continue"
    Write-Host "`nShutting down..." -ForegroundColor Yellow
    Stop-Job  $backendJob, $frontendJob  -ErrorAction SilentlyContinue
    Remove-Job $backendJob, $frontendJob -ErrorAction SilentlyContinue
    Write-Host "Done." -ForegroundColor Yellow
}
