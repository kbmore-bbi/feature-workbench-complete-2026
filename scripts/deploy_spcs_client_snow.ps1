param(
    [string]$EnvFile = "",
    [string]$ImageTag = "",
    [switch]$SkipBuild,
    [switch]$SkipLogin
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) {
    $EnvFile = Join-Path $RootDir "infra\snowflake\env\client.env"
}

$ToolsVenv = Join-Path $RootDir ".client-tools-venv"
$SnowExe = Join-Path $ToolsVenv "Scripts\snow.exe"
$RenderScript = Join-Path $PSScriptRoot "render_spcs_spec.py"
$SpecTemplate = Join-Path $RootDir "infra\snowflake\service-specs\webapp.yaml.tmpl"
$ArtifactsDir = Join-Path $RootDir "artifacts\client-spcs"

function Import-ClientEnv {
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

if (-not (Test-Path $SnowExe)) {
    Write-Host "Snow CLI tools are not bootstrapped yet. Running bootstrap script first."
    & (Join-Path $PSScriptRoot "bootstrap_client_spcs_tools.ps1")
}

$cfg = Import-ClientEnv -Path $EnvFile

$required = @(
    "SNOWFLAKE_CONNECTION",
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_USER",
    "SNOWFLAKE_ROLE",
    "SNOWFLAKE_WAREHOUSE",
    "SNOWFLAKE_DATABASE",
    "SNOWFLAKE_SCHEMA",
    "SNOWFLAKE_REGISTRY_HOST",
    "SNOWFLAKE_IMAGE_REPOSITORY",
    "SNOWFLAKE_COMPUTE_POOL",
    "WEBAPP_SERVICE_NAME",
    "SNOWFLAKE_EGRESS_INTEGRATION",
    "USERS_TABLE",
    "APP_ROLE_ADMIN",
    "APP_ROLE_PUBLISHER",
    "APP_ROLE_VIEWER",
    "SNOWFLAKE_STTM_BUILDER_AGENT"
)

foreach ($name in $required) {
    if (-not $cfg.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($cfg[$name])) {
        throw "$name must be set in $EnvFile"
    }
}

if (-not $ImageTag) {
    try {
        $ImageTag = (git -C $RootDir rev-parse --short HEAD).Trim()
    } catch {
        $ImageTag = Get-Date -Format "yyyyMMddHHmmss"
    }
}

$appName = if ($cfg.ContainsKey("APP_NAME") -and $cfg["APP_NAME"]) { $cfg["APP_NAME"] } else { "BBI AI Migration Workbench API" }
$appEnv = if ($cfg.ContainsKey("APP_ENV") -and $cfg["APP_ENV"]) { $cfg["APP_ENV"] } else { "client" }
$agentModel = if ($cfg.ContainsKey("SNOWFLAKE_AGENT_ORCHESTRATION_MODEL") -and $cfg["SNOWFLAKE_AGENT_ORCHESTRATION_MODEL"]) { $cfg["SNOWFLAKE_AGENT_ORCHESTRATION_MODEL"] } else { "claude-sonnet-4" }
$cors = if ($cfg.ContainsKey("CORS_ALLOWED_ORIGINS")) { $cfg["CORS_ALLOWED_ORIGINS"] } else { "" }
$snowflakeHost = if ($cfg.ContainsKey("SNOWFLAKE_HOST")) { $cfg["SNOWFLAKE_HOST"] } else { "" }
$semanticModelAgent = if ($cfg.ContainsKey("SNOWFLAKE_SEMANTIC_MODEL_AGENT") -and $cfg["SNOWFLAKE_SEMANTIC_MODEL_AGENT"]) { $cfg["SNOWFLAKE_SEMANTIC_MODEL_AGENT"] } else { "{0}.{1}.AGT_SEMANTIC_MODEL" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$relationshipsProcedure = if ($cfg.ContainsKey("SNOWFLAKE_RELATIONSHIPS_PROCEDURE") -and $cfg["SNOWFLAKE_RELATIONSHIPS_PROCEDURE"]) { $cfg["SNOWFLAKE_RELATIONSHIPS_PROCEDURE"] } else { "{0}.{1}.SP_GET_TABLE_RELATIONSHIPS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$semanticModelTable = if ($cfg.ContainsKey("SNOWFLAKE_SEMANTIC_MODEL_TABLE") -and $cfg["SNOWFLAKE_SEMANTIC_MODEL_TABLE"]) { $cfg["SNOWFLAKE_SEMANTIC_MODEL_TABLE"] } else { "{0}.{1}.TBL_SEMANTIC_MODELS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$derivedSourcesTable = if ($cfg.ContainsKey("SNOWFLAKE_DERIVED_SOURCES_TABLE") -and $cfg["SNOWFLAKE_DERIVED_SOURCES_TABLE"]) { $cfg["SNOWFLAKE_DERIVED_SOURCES_TABLE"] } else { "{0}.{1}.TBL_DERIVED_SOURCES" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required but was not found in PATH."
}

Write-Host "Testing Snow CLI connection '$($cfg["SNOWFLAKE_CONNECTION"])'"
& $SnowExe connection test -c $cfg["SNOWFLAKE_CONNECTION"]

if (-not $SkipLogin) {
    Write-Host "Logging Docker into Snowflake image registry via Snow CLI"
    & $SnowExe spcs image-registry login -c $cfg["SNOWFLAKE_CONNECTION"]
} else {
    Write-Host "Skipping image-registry login"
}

$env:SNOWFLAKE_DATABASE_LOWER = $cfg["SNOWFLAKE_DATABASE"].ToLowerInvariant()
$env:SNOWFLAKE_SCHEMA_LOWER = $cfg["SNOWFLAKE_SCHEMA"].ToLowerInvariant()
$env:SNOWFLAKE_IMAGE_REPOSITORY_LOWER = $cfg["SNOWFLAKE_IMAGE_REPOSITORY"].ToLowerInvariant()
$env:IMAGE_TAG = $ImageTag
$env:APP_NAME = $appName
$env:APP_ENV = $appEnv
$env:USERS_TABLE = $cfg["USERS_TABLE"]
$env:APP_ROLE_ADMIN = $cfg["APP_ROLE_ADMIN"]
$env:APP_ROLE_PUBLISHER = $cfg["APP_ROLE_PUBLISHER"]
$env:APP_ROLE_VIEWER = $cfg["APP_ROLE_VIEWER"]
$env:SNOWFLAKE_ACCOUNT = $cfg["SNOWFLAKE_ACCOUNT"]
$env:SNOWFLAKE_HOST = $snowflakeHost
$env:SNOWFLAKE_WAREHOUSE = $cfg["SNOWFLAKE_WAREHOUSE"]
$env:SNOWFLAKE_DATABASE = $cfg["SNOWFLAKE_DATABASE"]
$env:SNOWFLAKE_SCHEMA = $cfg["SNOWFLAKE_SCHEMA"]
$env:SNOWFLAKE_STTM_BUILDER_AGENT = $cfg["SNOWFLAKE_STTM_BUILDER_AGENT"]
$env:SNOWFLAKE_SEMANTIC_MODEL_AGENT = $semanticModelAgent
$env:SNOWFLAKE_RELATIONSHIPS_PROCEDURE = $relationshipsProcedure
$env:SNOWFLAKE_SEMANTIC_MODEL_TABLE = $semanticModelTable
$env:SNOWFLAKE_DERIVED_SOURCES_TABLE = $derivedSourcesTable
$env:SNOWFLAKE_AGENT_ORCHESTRATION_MODEL = $agentModel
$env:CORS_ALLOWED_ORIGINS = $cors

$registryBase = "{0}/{1}/{2}/{3}" -f `
    $cfg["SNOWFLAKE_REGISTRY_HOST"], `
    $env:SNOWFLAKE_DATABASE_LOWER, `
    $env:SNOWFLAKE_SCHEMA_LOWER, `
    $env:SNOWFLAKE_IMAGE_REPOSITORY_LOWER

function Build-AndPushImage {
    param(
        [string]$Name,
        [string]$ContextDir
    )

    $remoteImage = "{0}/{1}:{2}" -f $registryBase, $Name, $ImageTag
    Write-Host ""
    Write-Host "Building $Name -> $remoteImage"
    docker build --platform linux/amd64 -t $remoteImage $ContextDir
    Write-Host "Pushing $remoteImage"
    docker push $remoteImage
}

if (-not $SkipBuild) {
    Build-AndPushImage -Name "sttm-builder" -ContextDir (Join-Path $RootDir "services\sttm-builder")
    Build-AndPushImage -Name "frontend" -ContextDir (Join-Path $RootDir "frontend")
    Build-AndPushImage -Name "nginx" -ContextDir (Join-Path $RootDir "nginx")
} else {
    Write-Host "Skipping Docker build/push"
}

New-Item -ItemType Directory -Force -Path $ArtifactsDir | Out-Null
$RenderedSpec = Join-Path $ArtifactsDir ("webapp.{0}.yaml" -f $ImageTag)

Write-Host ""
Write-Host "Rendering service spec to $RenderedSpec"
python $RenderScript --template $SpecTemplate --output $RenderedSpec

Write-Host ""
Write-Host "Creating service '$($cfg["WEBAPP_SERVICE_NAME"])' if needed"
& $SnowExe spcs service create $cfg["WEBAPP_SERVICE_NAME"] `
    --connection $cfg["SNOWFLAKE_CONNECTION"] `
    --database $cfg["SNOWFLAKE_DATABASE"] `
    --schema $cfg["SNOWFLAKE_SCHEMA"] `
    --role $cfg["SNOWFLAKE_ROLE"] `
    --warehouse $cfg["SNOWFLAKE_WAREHOUSE"] `
    --compute-pool $cfg["SNOWFLAKE_COMPUTE_POOL"] `
    --spec-path $RenderedSpec `
    --eai-name $cfg["SNOWFLAKE_EGRESS_INTEGRATION"] `
    --if-not-exists `
    --format TABLE

Write-Host ""
Write-Host "Upgrading service '$($cfg["WEBAPP_SERVICE_NAME"])' to the latest spec"
& $SnowExe spcs service upgrade $cfg["WEBAPP_SERVICE_NAME"] `
    --connection $cfg["SNOWFLAKE_CONNECTION"] `
    --database $cfg["SNOWFLAKE_DATABASE"] `
    --schema $cfg["SNOWFLAKE_SCHEMA"] `
    --role $cfg["SNOWFLAKE_ROLE"] `
    --warehouse $cfg["SNOWFLAKE_WAREHOUSE"] `
    --spec-path $RenderedSpec `
    --format TABLE

Write-Host ""
Write-Host "Listing service endpoints"
& $SnowExe spcs service list-endpoints $cfg["WEBAPP_SERVICE_NAME"] `
    --connection $cfg["SNOWFLAKE_CONNECTION"] `
    --database $cfg["SNOWFLAKE_DATABASE"] `
    --schema $cfg["SNOWFLAKE_SCHEMA"] `
    --role $cfg["SNOWFLAKE_ROLE"] `
    --warehouse $cfg["SNOWFLAKE_WAREHOUSE"] `
    --format TABLE

Write-Host ""
Write-Host "Deployment complete."
Write-Host "Rendered spec: $RenderedSpec"
Write-Host "Next checks:"
Write-Host "  1. snow spcs service status $($cfg["WEBAPP_SERVICE_NAME"]) -c $($cfg["SNOWFLAKE_CONNECTION"]) --database $($cfg["SNOWFLAKE_DATABASE"]) --schema $($cfg["SNOWFLAKE_SCHEMA"])"
Write-Host "  2. snow spcs service list-containers $($cfg["WEBAPP_SERVICE_NAME"]) -c $($cfg["SNOWFLAKE_CONNECTION"]) --database $($cfg["SNOWFLAKE_DATABASE"]) --schema $($cfg["SNOWFLAKE_SCHEMA"])"
Write-Host "  3. Open the public endpoint from the command output and verify Snowflake/Okta sign-in"
