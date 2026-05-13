param(
    [string]$EnvFile = "",
    [string]$ImageTag = "",
    [switch]$SkipBuild,
    [switch]$SkipLogin,
    [switch]$ForceRecreateConnection,
    [string]$PythonExe = "",
    [string]$SnowflakeCliVersion = ""
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) {
    $EnvFile = Join-Path $RootDir "infra\snowflake\env\client.env"
}

$bootstrapArgs = @{}
if ($PythonExe) {
    $bootstrapArgs["PythonExe"] = $PythonExe
}
if ($SnowflakeCliVersion) {
    $bootstrapArgs["SnowflakeCliVersion"] = $SnowflakeCliVersion
}

& (Join-Path $PSScriptRoot "bootstrap_client_spcs_tools.ps1") @bootstrapArgs

$configureArgs = @{
    EnvFile = $EnvFile
}
if ($ForceRecreateConnection) {
    $configureArgs["ForceRecreate"] = $true
}

& (Join-Path $PSScriptRoot "configure_client_snow_connection.ps1") @configureArgs

$bootstrapMetadataArgs = @{
    EnvFile = $EnvFile
}

& (Join-Path $PSScriptRoot "bootstrap_sttm_metadata_infra.ps1") @bootstrapMetadataArgs

$deployArgs = @{
    EnvFile = $EnvFile
}
if ($ImageTag) {
    $deployArgs["ImageTag"] = $ImageTag
}
if ($SkipBuild) {
    $deployArgs["SkipBuild"] = $true
}
if ($SkipLogin) {
    $deployArgs["SkipLogin"] = $true
}

& (Join-Path $PSScriptRoot "deploy_spcs_client_snow.ps1") @deployArgs
