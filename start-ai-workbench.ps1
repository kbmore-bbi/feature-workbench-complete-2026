param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Delegate = Join-Path $RootDir "start-ai-workbench-dev.ps1"

& $Delegate -BackendPort $BackendPort -FrontendPort $FrontendPort
