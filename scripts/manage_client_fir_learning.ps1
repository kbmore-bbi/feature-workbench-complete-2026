param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CliArgs
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $RepoRoot "services\sttm-builder\.venv\Scripts\python.exe"
$Script = Join-Path $PSScriptRoot "manage_client_fir_learning.py"

if (-not (Test-Path $Python)) {
    throw "Python environment not found at $Python. Run the client setup/bootstrap first."
}

& $Python $Script @CliArgs
exit $LASTEXITCODE
