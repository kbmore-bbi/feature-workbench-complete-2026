# ============================================================
# stop-ai-workbench-dev.ps1
#
# Force-stops any dev-server processes that may have been left
# behind by start-ai-workbench-dev.ps1. Useful when Turbopack /
# Next.js / Uvicorn crashed mid-run and you are seeing:
#   - "EADDRINUSE: address already in use :::3000"
#   - "Insufficient system resources (os error 1450)"
#   - "bash: fork: Resource temporarily unavailable"
#
# This script ONLY targets known dev tooling (node, npm, next,
# uvicorn, python in the project venv) and PowerShell background
# jobs created by start-ai-workbench-dev.ps1.
# It does NOT touch system processes.
# ============================================================

$ErrorActionPreference = "Continue"

$ROOT_DIR     = Split-Path -Parent $MyInvocation.MyCommand.Definition
$FRONTEND_DIR = Join-Path $ROOT_DIR "frontend"
$VENV_DIR     = Join-Path $ROOT_DIR "services\sttm-builder\.venv"

function Log($msg) { Write-Host "[stop-dev] $msg" -ForegroundColor Yellow }

# 1. Stop any PowerShell background jobs from this session.
$jobs = Get-Job -ErrorAction SilentlyContinue
if ($jobs) {
    Log "Stopping $($jobs.Count) PowerShell background job(s)..."
    Stop-Job  $jobs -ErrorAction SilentlyContinue
    Remove-Job $jobs -Force -ErrorAction SilentlyContinue
}

# 2. Kill node / npm processes whose working dir is inside the frontend folder.
$nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'npm.cmd' OR Name = 'next.exe'" -ErrorAction SilentlyContinue
foreach ($p in $nodeProcs) {
    $cmd = "$($p.CommandLine)"
    if ($cmd -like "*$FRONTEND_DIR*" -or $cmd -like "*next dev*" -or $cmd -like "*next-server*" -or $cmd -like "*turbopack*") {
        Log "Killing node process $($p.ProcessId) -> $cmd"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

# 3. Kill python / uvicorn processes from the project venv.
$pyProcs = Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe' OR Name = 'uvicorn.exe'" -ErrorAction SilentlyContinue
foreach ($p in $pyProcs) {
    $cmd = "$($p.CommandLine)"
    if ($cmd -like "*$VENV_DIR*" -or $cmd -like "*uvicorn*app.main*") {
        Log "Killing python/uvicorn process $($p.ProcessId) -> $cmd"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

# 4. Free common dev ports (best-effort).
foreach ($port in @(3000, 8000)) {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $owners) {
        Log "Releasing port $port held by PID $($conn.OwningProcess)"
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

Log "Done. You can now re-run start-ai-workbench-dev.ps1."
