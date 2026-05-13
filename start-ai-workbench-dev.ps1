param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendScript = Join-Path $RootDir "scripts\start_sttm_backend_local.ps1"
$FrontendDir = Join-Path $RootDir "frontend"
$BackendOrigin = "http://127.0.0.1:$BackendPort"

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    Push-Location $FrontendDir
    try {
        npm install
    }
    finally {
        Pop-Location
    }
}

Write-Host "Starting backend on http://127.0.0.1:$BackendPort"
$backendArgs = @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $BackendScript,
    "-Port", "$BackendPort"
)
Start-Process powershell -ArgumentList $backendArgs

Write-Host "Starting frontend on http://127.0.0.1:$FrontendPort"
Push-Location $FrontendDir
try {
    $env:PORT = "$FrontendPort"
    $env:BACKEND_DEV_ORIGIN = $BackendOrigin
    $env:NEXT_PUBLIC_APP_ENV = "local"
    npm run dev
}
finally {
    Pop-Location
}
