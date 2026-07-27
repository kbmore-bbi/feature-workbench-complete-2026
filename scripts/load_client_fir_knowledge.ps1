$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$PythonExe = Join-Path $RootDir "services\sttm-builder\.venv\Scripts\python.exe"
$LoaderScript = Join-Path $PSScriptRoot "load_client_fir_knowledge.py"

if (-not (Test-Path $PythonExe)) {
    throw (
        "The STTM backend virtualenv was not found at $PythonExe. " +
        "Run release-packages\...\extract-and-setup.ps1 or create the backend " +
        "virtualenv and install services\sttm-builder before loading FIR knowledge."
    )
}
Write-Host "Loading client FIR knowledge"
Write-Host "Python: $PythonExe"

& $PythonExe $LoaderScript @args
if ($LASTEXITCODE -ne 0) {
    throw "Client FIR knowledge loading failed with exit code $LASTEXITCODE"
}
