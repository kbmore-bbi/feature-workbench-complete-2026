param(
    [string]$EnvFile = "",
    [string]$ImageTag = "",
    [switch]$SkipBuild,
    [switch]$SkipLogin,
    [switch]$EnsureComputePools
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) {
    $EnvFile = Join-Path $RootDir "infra\snowflake\env\client.env"
}

$ToolsVenv = Join-Path $RootDir ".client-tools-venv"
$PythonExe = Join-Path $ToolsVenv "Scripts\python.exe"
$RenderScript = Join-Path $PSScriptRoot "render_spcs_spec.py"
$SpecTemplate = Join-Path $RootDir "infra\snowflake\service-specs\webapp.yaml.tmpl"
$AutomapSpecTemplate = Join-Path $RootDir "infra\snowflake\service-specs\automap-worker.yaml.tmpl"
$ArtifactsDir = Join-Path $RootDir "artifacts\client-spcs"

function Invoke-Checked {
    param(
        [scriptblock]$Command,
        [string]$Description
    )

    Write-Host ""
    Write-Host "==> $Description"
    & $Command
    $exitCode = $LASTEXITCODE

    if ($null -ne $exitCode -and $exitCode -ne 0) {
        throw "$Description failed with exit code $exitCode"
    }
}

function Resolve-SnowCli {
    param([string]$VenvPath)

    $candidates = @(
        (Join-Path $VenvPath "Scripts\snow.exe"),
        (Join-Path $VenvPath "Scripts\snow.cmd"),
        (Join-Path $VenvPath "Scripts\snow")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

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

function Convert-ToDnsLabel {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }

    return $Value.Trim().ToLowerInvariant().Replace("_", "-")
}

function Require-Env {
    param(
        [hashtable]$Cfg,
        [string[]]$Names
    )

    foreach ($name in $Names) {
        if (-not $Cfg.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($Cfg[$name])) {
            throw "$name must be set in $EnvFile"
        }
    }
}

function Build-AndPushImage {
    param(
        [string]$Name,
        [string]$ContextDir,
        [string]$RemoteImage,
        [string[]]$BuildArgs = @()
    )
    Invoke-Checked -Description "Building Docker image $Name -> $RemoteImage" -Command {
        $buildArgFlags = $BuildArgs | ForEach-Object { "--build-arg", $_ }
        docker build --platform linux/amd64 @buildArgFlags -t $RemoteImage $ContextDir
    }
    Invoke-Checked -Description "Pushing Docker image $RemoteImage" -Command {
        docker push $RemoteImage
    }
}

if (-not (Resolve-SnowCli -VenvPath $ToolsVenv)) {
    Invoke-Checked -Description "Bootstrapping Snow CLI tools" -Command {
        & (Join-Path $PSScriptRoot "bootstrap_client_spcs_tools.ps1")
    }
}

$SnowExe = Resolve-SnowCli -VenvPath $ToolsVenv
if (-not $SnowExe) {
    throw "Snow CLI is unavailable after bootstrap. Check .client-tools-venv\Scripts."
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
    "SNOWFLAKE_SEMANTIC_VIEWS_DATABASE",
    "SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA",
    "SNOWFLAKE_REGISTRY_HOST",
    "SNOWFLAKE_IMAGE_REPOSITORY",
    "SNOWFLAKE_COMPUTE_POOL",
    "WEBAPP_SERVICE_NAME",
    "SNOWFLAKE_EGRESS_INTEGRATION",
    "USERS_TABLE",
    "APP_ROLE_ADMIN",
    "APP_ROLE_PUBLISHER",
    "APP_ROLE_VIEWER",
    "SNOWFLAKE_STTM_BUILDER_AGENT",
    "SNOWFLAKE_SOURCE_MAPPING_AGENT"
)

Require-Env -Cfg $cfg -Names $required

$deployAutomap = $cfg.ContainsKey("AUTO_MAPPING_SERVICE_NAME") -and -not [string]::IsNullOrWhiteSpace($cfg["AUTO_MAPPING_SERVICE_NAME"])
if ($deployAutomap) {
    Require-Env -Cfg $cfg -Names @("AUTO_MAPPING_COMPUTE_POOL", "AUTO_MAPPING_SERVICE_NAME")
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
$authMode = if ($cfg.ContainsKey("AUTH_MODE") -and $cfg["AUTH_MODE"]) { $cfg["AUTH_MODE"] } else { "custom_oauth" }
$executeAsCaller = if ($cfg.ContainsKey("SPCS_EXECUTE_AS_CALLER_ENABLED") -and $cfg["SPCS_EXECUTE_AS_CALLER_ENABLED"]) { $cfg["SPCS_EXECUTE_AS_CALLER_ENABLED"] } else { "true" }
$enableCustomCredentials = if ($authMode -eq "custom_oauth") { "true" } else { "false" }

$oauthSecretObject = if ($cfg.ContainsKey("SNOWFLAKE_OAUTH_CLIENT_SECRET_OBJECT") -and $cfg["SNOWFLAKE_OAUTH_CLIENT_SECRET_OBJECT"]) { $cfg["SNOWFLAKE_OAUTH_CLIENT_SECRET_OBJECT"] } else { "{0}.{1}.STTM_BUILDER_OAUTH_CLIENT_CREDENTIALS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$oauthSessionSecretObject = if ($cfg.ContainsKey("SNOWFLAKE_OAUTH_SESSION_SECRET_OBJECT") -and $cfg["SNOWFLAKE_OAUTH_SESSION_SECRET_OBJECT"]) { $cfg["SNOWFLAKE_OAUTH_SESSION_SECRET_OBJECT"] } else { "{0}.{1}.STTM_BUILDER_OAUTH_SESSION_KEYS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }

$oauthAuthorizeUrl = if ($cfg.ContainsKey("SNOWFLAKE_OAUTH_AUTHORIZE_URL")) { $cfg["SNOWFLAKE_OAUTH_AUTHORIZE_URL"] } else { "" }
$oauthTokenUrl = if ($cfg.ContainsKey("SNOWFLAKE_OAUTH_TOKEN_URL")) { $cfg["SNOWFLAKE_OAUTH_TOKEN_URL"] } else { "" }
$oauthRedirectUri = if ($cfg.ContainsKey("SNOWFLAKE_OAUTH_REDIRECT_URI")) { $cfg["SNOWFLAKE_OAUTH_REDIRECT_URI"] } else { "" }
$oauthScope = if ($cfg.ContainsKey("SNOWFLAKE_OAUTH_SCOPE") -and $cfg["SNOWFLAKE_OAUTH_SCOPE"]) { $cfg["SNOWFLAKE_OAUTH_SCOPE"] } else { "session:role-any" }

if ($authMode -eq "custom_oauth") {
    foreach ($entry in @{
        "SNOWFLAKE_OAUTH_CLIENT_SECRET_OBJECT" = $oauthSecretObject
        "SNOWFLAKE_OAUTH_SESSION_SECRET_OBJECT" = $oauthSessionSecretObject
        "SNOWFLAKE_OAUTH_AUTHORIZE_URL" = $oauthAuthorizeUrl
        "SNOWFLAKE_OAUTH_TOKEN_URL" = $oauthTokenUrl
        "SNOWFLAKE_OAUTH_REDIRECT_URI" = $oauthRedirectUri
    }.GetEnumerator()) {
        if ([string]::IsNullOrWhiteSpace($entry.Value)) {
            throw "$($entry.Key) must be set when AUTH_MODE=custom_oauth"
        }
    }
}

$agentModel = if ($cfg.ContainsKey("SNOWFLAKE_AGENT_ORCHESTRATION_MODEL") -and $cfg["SNOWFLAKE_AGENT_ORCHESTRATION_MODEL"]) { $cfg["SNOWFLAKE_AGENT_ORCHESTRATION_MODEL"] } else { "claude-sonnet-4" }
$cors = if ($cfg.ContainsKey("CORS_ALLOWED_ORIGINS")) { $cfg["CORS_ALLOWED_ORIGINS"] } else { "" }
$controlWarehouse = if ($cfg.ContainsKey("SNOWFLAKE_CONTROL_WAREHOUSE") -and $cfg["SNOWFLAKE_CONTROL_WAREHOUSE"]) { $cfg["SNOWFLAKE_CONTROL_WAREHOUSE"] } else { $cfg["SNOWFLAKE_WAREHOUSE"] }
$agentWarehouse = if ($cfg.ContainsKey("SNOWFLAKE_AGENT_WAREHOUSE") -and $cfg["SNOWFLAKE_AGENT_WAREHOUSE"]) { $cfg["SNOWFLAKE_AGENT_WAREHOUSE"] } else { $controlWarehouse }
$executionWarehouse = if ($cfg.ContainsKey("SNOWFLAKE_EXECUTION_WAREHOUSE") -and $cfg["SNOWFLAKE_EXECUTION_WAREHOUSE"]) { $cfg["SNOWFLAKE_EXECUTION_WAREHOUSE"] } else { $controlWarehouse }
$autoMappingWarehouse = if ($cfg.ContainsKey("AUTO_MAPPING_WAREHOUSE") -and $cfg["AUTO_MAPPING_WAREHOUSE"]) { $cfg["AUTO_MAPPING_WAREHOUSE"] } else { $agentWarehouse }
$controlStatementTimeout = if ($cfg.ContainsKey("SNOWFLAKE_CONTROL_STATEMENT_TIMEOUT_SECONDS")) { $cfg["SNOWFLAKE_CONTROL_STATEMENT_TIMEOUT_SECONDS"] } else { "60" }
$agentStatementTimeout = if ($cfg.ContainsKey("SNOWFLAKE_AGENT_STATEMENT_TIMEOUT_SECONDS")) { $cfg["SNOWFLAKE_AGENT_STATEMENT_TIMEOUT_SECONDS"] } else { "300" }
$executionStatementTimeout = if ($cfg.ContainsKey("SNOWFLAKE_EXECUTION_STATEMENT_TIMEOUT_SECONDS")) { $cfg["SNOWFLAKE_EXECUTION_STATEMENT_TIMEOUT_SECONDS"] } else { "900" }
$automapStatementTimeout = if ($cfg.ContainsKey("SNOWFLAKE_AUTOMAP_STATEMENT_TIMEOUT_SECONDS")) { $cfg["SNOWFLAKE_AUTOMAP_STATEMENT_TIMEOUT_SECONDS"] } else { "600" }
$sessionHealthcheckInterval = if ($cfg.ContainsKey("SNOWFLAKE_SESSION_HEALTHCHECK_INTERVAL_SECONDS")) { $cfg["SNOWFLAKE_SESSION_HEALTHCHECK_INTERVAL_SECONDS"] } else { "0" }
$webPoolMinNodes = if ($cfg.ContainsKey("WEB_COMPUTE_POOL_MIN_NODES")) { $cfg["WEB_COMPUTE_POOL_MIN_NODES"] } else { "1" }
$webPoolMaxNodes = if ($cfg.ContainsKey("WEB_COMPUTE_POOL_MAX_NODES")) { $cfg["WEB_COMPUTE_POOL_MAX_NODES"] } else { "1" }
$webPoolFamily = if ($cfg.ContainsKey("WEB_COMPUTE_POOL_INSTANCE_FAMILY")) { $cfg["WEB_COMPUTE_POOL_INSTANCE_FAMILY"] } else { "CPU_X64_S" }
$webPoolSuspend = if ($cfg.ContainsKey("WEB_COMPUTE_POOL_AUTO_SUSPEND_SECONDS")) { $cfg["WEB_COMPUTE_POOL_AUTO_SUSPEND_SECONDS"] } else { "3600" }
$webServiceMinInstances = if ($cfg.ContainsKey("WEB_SERVICE_MIN_INSTANCES")) { $cfg["WEB_SERVICE_MIN_INSTANCES"] } else { "1" }
$webServiceMaxInstances = if ($cfg.ContainsKey("WEB_SERVICE_MAX_INSTANCES")) { $cfg["WEB_SERVICE_MAX_INSTANCES"] } else { "1" }
$automapPoolMinNodes = if ($cfg.ContainsKey("AUTO_MAPPING_COMPUTE_POOL_MIN_NODES")) { $cfg["AUTO_MAPPING_COMPUTE_POOL_MIN_NODES"] } else { "2" }
$automapPoolMaxNodes = if ($cfg.ContainsKey("AUTO_MAPPING_COMPUTE_POOL_MAX_NODES")) { $cfg["AUTO_MAPPING_COMPUTE_POOL_MAX_NODES"] } else { "2" }
$automapPoolFamily = if ($cfg.ContainsKey("AUTO_MAPPING_COMPUTE_POOL_INSTANCE_FAMILY")) { $cfg["AUTO_MAPPING_COMPUTE_POOL_INSTANCE_FAMILY"] } else { "CPU_X64_S" }
$automapPoolSuspend = if ($cfg.ContainsKey("AUTO_MAPPING_COMPUTE_POOL_AUTO_SUSPEND_SECONDS")) { $cfg["AUTO_MAPPING_COMPUTE_POOL_AUTO_SUSPEND_SECONDS"] } else { "3600" }
$automapServiceMinInstances = if ($cfg.ContainsKey("AUTO_MAPPING_SERVICE_MIN_INSTANCES")) { $cfg["AUTO_MAPPING_SERVICE_MIN_INSTANCES"] } else { "2" }
$automapServiceMaxInstances = if ($cfg.ContainsKey("AUTO_MAPPING_SERVICE_MAX_INSTANCES")) { $cfg["AUTO_MAPPING_SERVICE_MAX_INSTANCES"] } else { "2" }

$sourceMappingAgent = if ($cfg.ContainsKey("SNOWFLAKE_SOURCE_MAPPING_AGENT") -and $cfg["SNOWFLAKE_SOURCE_MAPPING_AGENT"]) { $cfg["SNOWFLAKE_SOURCE_MAPPING_AGENT"] } else { "{0}.{1}.AGT_SOURCE_MAPPING" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$semanticModelAgent = if ($cfg.ContainsKey("SNOWFLAKE_SEMANTIC_MODEL_AGENT") -and $cfg["SNOWFLAKE_SEMANTIC_MODEL_AGENT"]) { $cfg["SNOWFLAKE_SEMANTIC_MODEL_AGENT"] } else { "{0}.{1}.AGT_SEMANTIC_MODEL" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$dbtConversionAgent = if ($cfg.ContainsKey("SNOWFLAKE_DBT_CONVERSION_AGENT") -and $cfg["SNOWFLAKE_DBT_CONVERSION_AGENT"]) { $cfg["SNOWFLAKE_DBT_CONVERSION_AGENT"] } else { "{0}.{1}.AGT_DBT_CONVERSION" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$testCaseGenerationAgent = if ($cfg.ContainsKey("SNOWFLAKE_TEST_CASE_GENERATION_AGENT") -and $cfg["SNOWFLAKE_TEST_CASE_GENERATION_AGENT"]) { $cfg["SNOWFLAKE_TEST_CASE_GENERATION_AGENT"] } else { "{0}.{1}.AGT_DBT_TEST_GENERATION" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$conversationAgent = if ($cfg.ContainsKey("SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT") -and $cfg["SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT"]) { $cfg["SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT"] } else { $cfg["SNOWFLAKE_STTM_BUILDER_AGENT"] }

$relationshipsProcedure = if ($cfg.ContainsKey("SNOWFLAKE_RELATIONSHIPS_PROCEDURE") -and $cfg["SNOWFLAKE_RELATIONSHIPS_PROCEDURE"]) { $cfg["SNOWFLAKE_RELATIONSHIPS_PROCEDURE"] } else { "{0}.{1}.SP_GET_TABLE_RELATIONSHIPS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$semanticModelTable = if ($cfg.ContainsKey("SNOWFLAKE_SEMANTIC_MODEL_TABLE") -and $cfg["SNOWFLAKE_SEMANTIC_MODEL_TABLE"]) { $cfg["SNOWFLAKE_SEMANTIC_MODEL_TABLE"] } else { "{0}.{1}.TBL_SEMANTIC_MODELS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$semanticViewsDatabase = if ($cfg.ContainsKey("SNOWFLAKE_SEMANTIC_VIEWS_DATABASE") -and $cfg["SNOWFLAKE_SEMANTIC_VIEWS_DATABASE"]) { $cfg["SNOWFLAKE_SEMANTIC_VIEWS_DATABASE"] } else { $cfg["SNOWFLAKE_DATABASE"] }
$semanticViewsSchema = if ($cfg.ContainsKey("SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA") -and $cfg["SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA"]) { $cfg["SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA"] } else { $cfg["SNOWFLAKE_SCHEMA"] }
$semanticTableViewsTable = if ($cfg.ContainsKey("SNOWFLAKE_SEMANTIC_TABLE_VIEWS_TABLE") -and $cfg["SNOWFLAKE_SEMANTIC_TABLE_VIEWS_TABLE"]) { $cfg["SNOWFLAKE_SEMANTIC_TABLE_VIEWS_TABLE"] } else { "LATEST_TABLE_VIEWS" }
$semanticColumnViewsTable = if ($cfg.ContainsKey("SNOWFLAKE_SEMANTIC_COLUMN_VIEWS_TABLE") -and $cfg["SNOWFLAKE_SEMANTIC_COLUMN_VIEWS_TABLE"]) { $cfg["SNOWFLAKE_SEMANTIC_COLUMN_VIEWS_TABLE"] } else { "LATEST_COLUMN_VIEWS" }
$semanticNativeViewsTable = if ($cfg.ContainsKey("SNOWFLAKE_SEMANTIC_NATIVE_VIEWS_TABLE") -and $cfg["SNOWFLAKE_SEMANTIC_NATIVE_VIEWS_TABLE"]) { $cfg["SNOWFLAKE_SEMANTIC_NATIVE_VIEWS_TABLE"] } else { "LATEST_NATIVE_VIEWS" }
$derivedSourcesTable = if ($cfg.ContainsKey("SNOWFLAKE_DERIVED_SOURCES_TABLE") -and $cfg["SNOWFLAKE_DERIVED_SOURCES_TABLE"]) { $cfg["SNOWFLAKE_DERIVED_SOURCES_TABLE"] } else { "{0}.{1}.TBL_DERIVED_SOURCES" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$conversationTurnsTable = if ($cfg.ContainsKey("SNOWFLAKE_CONVERSATION_TURNS_TABLE") -and $cfg["SNOWFLAKE_CONVERSATION_TURNS_TABLE"]) { $cfg["SNOWFLAKE_CONVERSATION_TURNS_TABLE"] } else { "{0}.{1}.TBL_WORKBENCH_CONVERSATION_TURNS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$conversationSegmentsTable = if ($cfg.ContainsKey("SNOWFLAKE_CONVERSATION_SEGMENTS_TABLE") -and $cfg["SNOWFLAKE_CONVERSATION_SEGMENTS_TABLE"]) { $cfg["SNOWFLAKE_CONVERSATION_SEGMENTS_TABLE"] } else { "{0}.{1}.TBL_WORKBENCH_CONVERSATION_SEGMENTS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$agentArtifactStage = if ($cfg.ContainsKey("SNOWFLAKE_AGENT_ARTIFACT_STAGE") -and $cfg["SNOWFLAKE_AGENT_ARTIFACT_STAGE"]) { $cfg["SNOWFLAKE_AGENT_ARTIFACT_STAGE"] } else { "{0}.{1}.AI_WORKBENCH_ARTIFACTS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$agentInlineArtifactLimit = if ($cfg.ContainsKey("AGENT_INLINE_ARTIFACT_LIMIT_BYTES")) { $cfg["AGENT_INLINE_ARTIFACT_LIMIT_BYTES"] } else { "32768" }
$agentArtifactRetention = if ($cfg.ContainsKey("AGENT_ARTIFACT_DRAFT_RETENTION_DAYS")) { $cfg["AGENT_ARTIFACT_DRAFT_RETENTION_DAYS"] } else { "90" }
$agentContextLimit = if ($cfg.ContainsKey("AGENT_CONTEXT_LIMIT_TOKENS")) { $cfg["AGENT_CONTEXT_LIMIT_TOKENS"] } else { "90000" }
$agentRolloverRatio = if ($cfg.ContainsKey("AGENT_THREAD_ROLLOVER_RATIO")) { $cfg["AGENT_THREAD_ROLLOVER_RATIO"] } else { "0.65" }
$agentHardRatio = if ($cfg.ContainsKey("AGENT_THREAD_HARD_RATIO")) { $cfg["AGENT_THREAD_HARD_RATIO"] } else { "0.80" }
$agentRecentTurns = if ($cfg.ContainsKey("AGENT_RECENT_TURNS_TO_KEEP")) { $cfg["AGENT_RECENT_TURNS_TO_KEEP"] } else { "8" }
$agentMaxTurns = if ($cfg.ContainsKey("AGENT_MAX_TURNS_PER_SEGMENT")) { $cfg["AGENT_MAX_TURNS_PER_SEGMENT"] } else { "60" }
$preparedWorkspaceContextV2 = if ($cfg.ContainsKey("PREPARED_WORKSPACE_CONTEXT_V2")) { $cfg["PREPARED_WORKSPACE_CONTEXT_V2"] } else { "true" }
$assistantStreamingV2 = if ($cfg.ContainsKey("ASSISTANT_STREAMING_V2")) { $cfg["ASSISTANT_STREAMING_V2"] } else { "true" }
$firTargetMappingPatternsV2 = if ($cfg.ContainsKey("FIR_TARGET_MAPPING_PATTERNS_V2")) { $cfg["FIR_TARGET_MAPPING_PATTERNS_V2"] } else { "true" }
$firDurableJobsV2 = if ($cfg.ContainsKey("FIR_DURABLE_JOBS_V2")) { $cfg["FIR_DURABLE_JOBS_V2"] } else { "true" }
$preparedContextL1IdleSeconds = if ($cfg.ContainsKey("PREPARED_CONTEXT_L1_IDLE_SECONDS")) { $cfg["PREPARED_CONTEXT_L1_IDLE_SECONDS"] } else { "3600" }
$preparedContextSoftRevalidateSeconds = if ($cfg.ContainsKey("PREPARED_CONTEXT_SOFT_REVALIDATE_SECONDS")) { $cfg["PREPARED_CONTEXT_SOFT_REVALIDATE_SECONDS"] } else { "86400" }
$preparedContextCleanupDays = if ($cfg.ContainsKey("PREPARED_CONTEXT_CLEANUP_DAYS")) { $cfg["PREPARED_CONTEXT_CLEANUP_DAYS"] } else { "30" }
$preparedContextDebounceMs = if ($cfg.ContainsKey("PREPARED_CONTEXT_DEBOUNCE_MS")) { $cfg["PREPARED_CONTEXT_DEBOUNCE_MS"] } else { "750" }
$preparedWorkspaceContextsTable = if ($cfg.ContainsKey("SNOWFLAKE_PREPARED_WORKSPACE_CONTEXTS_TABLE")) { $cfg["SNOWFLAKE_PREPARED_WORKSPACE_CONTEXTS_TABLE"] } else { "TBL_PREPARED_WORKSPACE_CONTEXTS" }
$targetMappingPatternsTable = if ($cfg.ContainsKey("SNOWFLAKE_TARGET_MAPPING_PATTERNS_TABLE")) { $cfg["SNOWFLAKE_TARGET_MAPPING_PATTERNS_TABLE"] } else { "TBL_FIR_TARGET_MAPPING_PATTERNS" }
$firLearningJobsTable = if ($cfg.ContainsKey("SNOWFLAKE_FIR_LEARNING_JOBS_TABLE")) { $cfg["SNOWFLAKE_FIR_LEARNING_JOBS_TABLE"] } else { "TBL_FIR_LEARNING_JOBS" }
$firLearningWorkItemsTable = if ($cfg.ContainsKey("SNOWFLAKE_FIR_LEARNING_WORK_ITEMS_TABLE")) { $cfg["SNOWFLAKE_FIR_LEARNING_WORK_ITEMS_TABLE"] } else { "TBL_FIR_LEARNING_WORK_ITEMS" }
$firAgentRequestTimeoutSeconds = if ($cfg.ContainsKey("FIR_AGENT_REQUEST_TIMEOUT_SECONDS")) { $cfg["FIR_AGENT_REQUEST_TIMEOUT_SECONDS"] } else { "840" }
$firAgentMaxAssetsPerRun = if ($cfg.ContainsKey("FIR_AGENT_MAX_ASSETS_PER_RUN")) { $cfg["FIR_AGENT_MAX_ASSETS_PER_RUN"] } else { "1" }
$firAgentMaxPatternsPerBatch = if ($cfg.ContainsKey("FIR_AGENT_MAX_PATTERNS_PER_BATCH")) { $cfg["FIR_AGENT_MAX_PATTERNS_PER_BATCH"] } else { "10" }
$firAgentMaxConcurrency = if ($cfg.ContainsKey("FIR_AGENT_MAX_CONCURRENCY")) { $cfg["FIR_AGENT_MAX_CONCURRENCY"] } else { "2" }
$firAgentRetryLimit = if ($cfg.ContainsKey("FIR_AGENT_RETRY_LIMIT")) { $cfg["FIR_AGENT_RETRY_LIMIT"] } else { "2" }
$firJobMaxRuntimeSeconds = if ($cfg.ContainsKey("FIR_JOB_MAX_RUNTIME_SECONDS")) { $cfg["FIR_JOB_MAX_RUNTIME_SECONDS"] } else { "3600" }
$conversationFeedbackTable = if ($cfg.ContainsKey("SNOWFLAKE_CONVERSATION_FEEDBACK_TABLE") -and $cfg["SNOWFLAKE_CONVERSATION_FEEDBACK_TABLE"]) { $cfg["SNOWFLAKE_CONVERSATION_FEEDBACK_TABLE"] } else { "{0}.{1}.TBL_WORKBENCH_FEEDBACK" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$conversationRecommendationsTable = if ($cfg.ContainsKey("SNOWFLAKE_CONVERSATION_RECOMMENDATIONS_TABLE") -and $cfg["SNOWFLAKE_CONVERSATION_RECOMMENDATIONS_TABLE"]) { $cfg["SNOWFLAKE_CONVERSATION_RECOMMENDATIONS_TABLE"] } else { "{0}.{1}.TBL_WORKBENCH_RECOMMENDATIONS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$relationshipFactsTable = if ($cfg.ContainsKey("SNOWFLAKE_RELATIONSHIP_FACTS_TABLE") -and $cfg["SNOWFLAKE_RELATIONSHIP_FACTS_TABLE"]) { $cfg["SNOWFLAKE_RELATIONSHIP_FACTS_TABLE"] } else { "{0}.{1}.TBL_WORKBENCH_RELATIONSHIP_FACTS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$ragDocumentsTable = if ($cfg.ContainsKey("SNOWFLAKE_RAG_DOCUMENTS_TABLE") -and $cfg["SNOWFLAKE_RAG_DOCUMENTS_TABLE"]) { $cfg["SNOWFLAKE_RAG_DOCUMENTS_TABLE"] } else { "{0}.{1}.TBL_WORKBENCH_RAG_DOCUMENTS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$ragSearchService = if ($cfg.ContainsKey("SNOWFLAKE_RAG_SEARCH_SERVICE") -and $cfg["SNOWFLAKE_RAG_SEARCH_SERVICE"]) { $cfg["SNOWFLAKE_RAG_SEARCH_SERVICE"] } else { "{0}.{1}.CSS_WORKBENCH_RAG" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }
$oauthSessionsTable = if ($cfg.ContainsKey("SNOWFLAKE_OAUTH_SESSIONS_TABLE") -and $cfg["SNOWFLAKE_OAUTH_SESSIONS_TABLE"]) { $cfg["SNOWFLAKE_OAUTH_SESSIONS_TABLE"] } else { "{0}.{1}.TBL_WORKBENCH_OAUTH_SESSIONS" -f $cfg["SNOWFLAKE_DATABASE"], $cfg["SNOWFLAKE_SCHEMA"] }

$authSessionCookieName = if ($cfg.ContainsKey("AUTH_SESSION_COOKIE_NAME") -and $cfg["AUTH_SESSION_COOKIE_NAME"]) { $cfg["AUTH_SESSION_COOKIE_NAME"] } else { "sttm_session" }
$authStateCookieName = if ($cfg.ContainsKey("AUTH_STATE_COOKIE_NAME") -and $cfg["AUTH_STATE_COOKIE_NAME"]) { $cfg["AUTH_STATE_COOKIE_NAME"] } else { "sttm_oauth_state" }
$authSessionCookieSecure = "true"
$authSessionCookieSameSite = if ($cfg.ContainsKey("AUTH_SESSION_COOKIE_SAMESITE") -and $cfg["AUTH_SESSION_COOKIE_SAMESITE"]) { $cfg["AUTH_SESSION_COOKIE_SAMESITE"] } else { "lax" }
$authPostLoginRedirectPath = if ($cfg.ContainsKey("AUTH_POST_LOGIN_REDIRECT_PATH") -and $cfg["AUTH_POST_LOGIN_REDIRECT_PATH"]) { $cfg["AUTH_POST_LOGIN_REDIRECT_PATH"] } else { "/dashboard" }
$authPostLogoutRedirectPath = if ($cfg.ContainsKey("AUTH_POST_LOGOUT_REDIRECT_PATH") -and $cfg["AUTH_POST_LOGOUT_REDIRECT_PATH"]) { $cfg["AUTH_POST_LOGOUT_REDIRECT_PATH"] } else { "/home" }

$autoMappingServiceTimeout = if ($cfg.ContainsKey("AUTO_MAPPING_SERVICE_TIMEOUT_SECONDS") -and $cfg["AUTO_MAPPING_SERVICE_TIMEOUT_SECONDS"]) { $cfg["AUTO_MAPPING_SERVICE_TIMEOUT_SECONDS"] } else { "300" }
$autoMappingServiceRetries = if ($cfg.ContainsKey("AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS") -and $cfg["AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS"]) { $cfg["AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS"] } else { "2" }
$autoMappingWorkerConcurrency = if ($cfg.ContainsKey("AUTO_MAPPING_WORKER_MAX_CONCURRENCY") -and $cfg["AUTO_MAPPING_WORKER_MAX_CONCURRENCY"]) { $cfg["AUTO_MAPPING_WORKER_MAX_CONCURRENCY"] } else { "5" }
$autoMappingProxyBatchSize = if ($cfg.ContainsKey("AUTO_MAPPING_PROXY_BATCH_SIZE") -and $cfg["AUTO_MAPPING_PROXY_BATCH_SIZE"]) { $cfg["AUTO_MAPPING_PROXY_BATCH_SIZE"] } else { "17" }
$autoMappingProxyMaxInFlight = if ($cfg.ContainsKey("AUTO_MAPPING_PROXY_MAX_IN_FLIGHT") -and $cfg["AUTO_MAPPING_PROXY_MAX_IN_FLIGHT"]) { $cfg["AUTO_MAPPING_PROXY_MAX_IN_FLIGHT"] } else { "2" }
$autoMapPipelineV2 = if ($cfg.ContainsKey("AUTO_MAP_PIPELINE_V2") -and $cfg["AUTO_MAP_PIPELINE_V2"]) { $cfg["AUTO_MAP_PIPELINE_V2"] } else { "false" }
$agentSpecSourceMappingSha256 = if ($cfg.ContainsKey("AGENT_SPEC_SOURCE_MAPPING_SHA256") -and $cfg["AGENT_SPEC_SOURCE_MAPPING_SHA256"]) { $cfg["AGENT_SPEC_SOURCE_MAPPING_SHA256"] } else { "b3a312d41aeff743a62522e7595098f9e61d9c0fd3735deb530feceb8cac91b3" }
$agentSpecTransformationRuleSha256 = if ($cfg.ContainsKey("AGENT_SPEC_TRANSFORMATION_RULE_SHA256") -and $cfg["AGENT_SPEC_TRANSFORMATION_RULE_SHA256"]) { $cfg["AGENT_SPEC_TRANSFORMATION_RULE_SHA256"] } else { "216ce641971e55b921462f26e117ec08479505d232f64bb1107fc926c3b4a999" }

if ($deployAutomap) {
    $autoMappingServiceNameDns = Convert-ToDnsLabel $cfg["AUTO_MAPPING_SERVICE_NAME"]
    $autoMappingSchemaDns = Convert-ToDnsLabel $cfg["SNOWFLAKE_SCHEMA"]
    $autoMappingDatabaseDns = Convert-ToDnsLabel $cfg["SNOWFLAKE_DATABASE"]
    $autoMappingInternalHost = "{0}.{1}.{2}.snowflakecomputing.internal" -f $autoMappingServiceNameDns, $autoMappingSchemaDns, $autoMappingDatabaseDns
    $autoMappingServiceUrl = if ($cfg.ContainsKey("AUTO_MAPPING_SERVICE_URL") -and $cfg["AUTO_MAPPING_SERVICE_URL"]) { $cfg["AUTO_MAPPING_SERVICE_URL"] } else { "http://{0}:8000" -f $autoMappingInternalHost }
} else {
    $autoMappingServiceUrl = ""
}

$snowflakeSessionRetries = if ($cfg.ContainsKey("SNOWFLAKE_SESSION_RETRY_ATTEMPTS") -and $cfg["SNOWFLAKE_SESSION_RETRY_ATTEMPTS"]) { $cfg["SNOWFLAKE_SESSION_RETRY_ATTEMPTS"] } else { "2" }
$snowflakeSessionRetryBackoff = if ($cfg.ContainsKey("SNOWFLAKE_SESSION_RETRY_BACKOFF_SECONDS") -and $cfg["SNOWFLAKE_SESSION_RETRY_BACKOFF_SECONDS"]) { $cfg["SNOWFLAKE_SESSION_RETRY_BACKOFF_SECONDS"] } else { "1.0" }
$snowflakeUserSessionCacheTtl = if ($cfg.ContainsKey("SNOWFLAKE_USER_SESSION_CACHE_TTL_SECONDS") -and $cfg["SNOWFLAKE_USER_SESSION_CACHE_TTL_SECONDS"]) { $cfg["SNOWFLAKE_USER_SESSION_CACHE_TTL_SECONDS"] } else { "1800" }
$snowflakeAgentRetries = if ($cfg.ContainsKey("SNOWFLAKE_AGENT_RETRY_ATTEMPTS") -and $cfg["SNOWFLAKE_AGENT_RETRY_ATTEMPTS"]) { $cfg["SNOWFLAKE_AGENT_RETRY_ATTEMPTS"] } else { "3" }
$snowflakeAgentRetryBackoff = if ($cfg.ContainsKey("SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS") -and $cfg["SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS"]) { $cfg["SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS"] } else { "1.0" }

$oauthSecretMappings = ""
if ($authMode -eq "custom_oauth") {
    $oauthSecretMappings = @"
      secrets:
        - snowflakeSecret: $oauthSecretObject
          secretKeyRef: username
          envVarName: SNOWFLAKE_OAUTH_CLIENT_ID
        - snowflakeSecret: $oauthSecretObject
          secretKeyRef: password
          envVarName: SNOWFLAKE_OAUTH_CLIENT_SECRET
        - snowflakeSecret: $oauthSessionSecretObject
          secretKeyRef: username
          envVarName: AUTH_SESSION_SECRET
        - snowflakeSecret: $oauthSessionSecretObject
          secretKeyRef: password
          envVarName: AUTH_SESSION_ENCRYPTION_KEY
"@
}

Invoke-Checked -Description "Checking Docker daemon" -Command {
    docker info
}

Invoke-Checked -Description "Testing Snow CLI connection '$($cfg["SNOWFLAKE_CONNECTION"])'" -Command {
    & $SnowExe connection test -c $cfg["SNOWFLAKE_CONNECTION"]
}

Write-Host ""
Write-Host "Semantic registry: $semanticViewsDatabase.$semanticViewsSchema"
foreach ($semanticObject in @(
    $semanticTableViewsTable,
    $semanticColumnViewsTable,
    $semanticNativeViewsTable
)) {
    Invoke-Checked -Description "Verifying semantic object $semanticViewsDatabase.$semanticViewsSchema.$semanticObject" -Command {
        & $SnowExe sql `
            -c $cfg["SNOWFLAKE_CONNECTION"] `
            -q "SELECT 1 FROM $semanticViewsDatabase.$semanticViewsSchema.$semanticObject LIMIT 0;"
    }
}

if ($EnsureComputePools) {
    Invoke-Checked -Description "Ensuring compute pool '$($cfg["SNOWFLAKE_COMPUTE_POOL"])' exists" -Command {
        & $SnowExe sql -c $cfg["SNOWFLAKE_CONNECTION"] -q "CREATE COMPUTE POOL IF NOT EXISTS $($cfg["SNOWFLAKE_COMPUTE_POOL"]) MIN_NODES = $webPoolMinNodes MAX_NODES = $webPoolMaxNodes INSTANCE_FAMILY = $webPoolFamily AUTO_RESUME = TRUE AUTO_SUSPEND_SECS = $webPoolSuspend;"
    }

    if ($deployAutomap) {
        Invoke-Checked -Description "Ensuring auto-mapping compute pool '$($cfg["AUTO_MAPPING_COMPUTE_POOL"])' exists" -Command {
            & $SnowExe sql -c $cfg["SNOWFLAKE_CONNECTION"] -q "CREATE COMPUTE POOL IF NOT EXISTS $($cfg["AUTO_MAPPING_COMPUTE_POOL"]) MIN_NODES = $automapPoolMinNodes MAX_NODES = $automapPoolMaxNodes INSTANCE_FAMILY = $automapPoolFamily AUTO_RESUME = TRUE AUTO_SUSPEND_SECS = $automapPoolSuspend;"
        }
    }
} else {
    Write-Host ""
    Write-Host "Skipping compute pool creation. Using existing compute pool(s)."
}

if (-not $SkipLogin) {
    Invoke-Checked -Description "Logging Docker into Snowflake image registry" -Command {
        & $SnowExe spcs image-registry login -c $cfg["SNOWFLAKE_CONNECTION"]
    }
} else {
    Write-Host "Skipping Snowflake image registry login."
}

$env:SNOWFLAKE_DATABASE_LOWER = $cfg["SNOWFLAKE_DATABASE"].ToLowerInvariant()
$env:SNOWFLAKE_SCHEMA_LOWER = $cfg["SNOWFLAKE_SCHEMA"].ToLowerInvariant()
$env:SNOWFLAKE_IMAGE_REPOSITORY_LOWER = $cfg["SNOWFLAKE_IMAGE_REPOSITORY"].ToLowerInvariant()
$env:IMAGE_TAG = $ImageTag

$registryBase = "{0}/{1}/{2}/{3}" -f `
    $cfg["SNOWFLAKE_REGISTRY_HOST"].ToLowerInvariant(), `
    $env:SNOWFLAKE_DATABASE_LOWER, `
    $env:SNOWFLAKE_SCHEMA_LOWER, `
    $env:SNOWFLAKE_IMAGE_REPOSITORY_LOWER

$sttmBuilderImage = "{0}/sttm-builder:{1}" -f $registryBase, $ImageTag
$automapImage = "{0}/sttm-automap-worker:{1}" -f $registryBase, $ImageTag
$frontendImage = "{0}/frontend:{1}" -f $registryBase, $ImageTag
$nginxImage = "{0}/nginx:{1}" -f $registryBase, $ImageTag

if (-not $SkipBuild) {
    Build-AndPushImage `
        -Name "sttm-builder" `
        -ContextDir (Join-Path $RootDir "services\sttm-builder") `
        -RemoteImage $sttmBuilderImage `
        -BuildArgs @(
            "PYTHON_BASE_IMAGE=python:3.11-slim"
        )

    if ($deployAutomap) {
        Build-AndPushImage `
            -Name "sttm-automap-worker" `
            -ContextDir (Join-Path $RootDir "services\sttm-builder") `
            -RemoteImage $automapImage `
            -BuildArgs @(
                "PYTHON_BASE_IMAGE=python:3.11-slim"
            )
    }

    Build-AndPushImage `
        -Name "frontend" `
        -ContextDir (Join-Path $RootDir "frontend") `
        -RemoteImage $frontendImage `
        -BuildArgs @(
            "NODE_BASE_IMAGE=node:22-alpine"
        )

    Build-AndPushImage `
        -Name "nginx" `
        -ContextDir (Join-Path $RootDir "nginx") `
        -RemoteImage $nginxImage `
        -BuildArgs @(
            "NGINX_BASE_IMAGE=nginx:1.27-alpine"
        )
} else {
    Write-Host "Skipping Docker build/push. Existing images with tag '$ImageTag' must already exist."
}

$env:APP_NAME = $appName
$env:APP_ENV = $appEnv
$env:AUTH_MODE = $authMode
$env:SPCS_EXECUTE_AS_CALLER_ENABLED = $executeAsCaller
$env:SPCS_ENABLE_CUSTOM_CREDENTIALS = $enableCustomCredentials
$env:SNOWFLAKE_OAUTH_SECRET_MAPPINGS = $oauthSecretMappings
$env:USERS_TABLE = $cfg["USERS_TABLE"]
$env:APP_ROLE_ADMIN = $cfg["APP_ROLE_ADMIN"]
$env:APP_ROLE_PUBLISHER = $cfg["APP_ROLE_PUBLISHER"]
$env:APP_ROLE_VIEWER = $cfg["APP_ROLE_VIEWER"]
$env:SNOWFLAKE_ACCOUNT = $cfg["SNOWFLAKE_ACCOUNT"]
$env:SNOWFLAKE_WAREHOUSE = $cfg["SNOWFLAKE_WAREHOUSE"]
$env:SNOWFLAKE_CONTROL_WAREHOUSE = $controlWarehouse
$env:SNOWFLAKE_AGENT_WAREHOUSE = $agentWarehouse
$env:SNOWFLAKE_EXECUTION_WAREHOUSE = $executionWarehouse
$env:AUTO_MAPPING_WAREHOUSE = $autoMappingWarehouse
$env:SNOWFLAKE_CONTROL_STATEMENT_TIMEOUT_SECONDS = $controlStatementTimeout
$env:SNOWFLAKE_AGENT_STATEMENT_TIMEOUT_SECONDS = $agentStatementTimeout
$env:SNOWFLAKE_EXECUTION_STATEMENT_TIMEOUT_SECONDS = $executionStatementTimeout
$env:SNOWFLAKE_AUTOMAP_STATEMENT_TIMEOUT_SECONDS = $automapStatementTimeout
$env:SNOWFLAKE_SESSION_HEALTHCHECK_INTERVAL_SECONDS = $sessionHealthcheckInterval
$env:SNOWFLAKE_DATABASE = $cfg["SNOWFLAKE_DATABASE"]
$env:SNOWFLAKE_SCHEMA = $cfg["SNOWFLAKE_SCHEMA"]
$env:SNOWFLAKE_STTM_BUILDER_AGENT = $cfg["SNOWFLAKE_STTM_BUILDER_AGENT"]
$env:SNOWFLAKE_SOURCE_MAPPING_AGENT = $sourceMappingAgent
$env:SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT = $conversationAgent
$env:SNOWFLAKE_SEMANTIC_MODEL_AGENT = $semanticModelAgent
$env:SNOWFLAKE_DBT_CONVERSION_AGENT = $dbtConversionAgent
$env:SNOWFLAKE_TEST_CASE_GENERATION_AGENT = $testCaseGenerationAgent
$env:SNOWFLAKE_RELATIONSHIPS_PROCEDURE = $relationshipsProcedure
$env:SNOWFLAKE_SEMANTIC_MODEL_TABLE = $semanticModelTable
$env:SNOWFLAKE_SEMANTIC_VIEWS_DATABASE = $semanticViewsDatabase
$env:SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA = $semanticViewsSchema
$env:SNOWFLAKE_SEMANTIC_TABLE_VIEWS_TABLE = $semanticTableViewsTable
$env:SNOWFLAKE_SEMANTIC_COLUMN_VIEWS_TABLE = $semanticColumnViewsTable
$env:SNOWFLAKE_SEMANTIC_NATIVE_VIEWS_TABLE = $semanticNativeViewsTable
$env:SNOWFLAKE_DERIVED_SOURCES_TABLE = $derivedSourcesTable
$env:SNOWFLAKE_CONVERSATION_TURNS_TABLE = $conversationTurnsTable
$env:SNOWFLAKE_CONVERSATION_SEGMENTS_TABLE = $conversationSegmentsTable
$env:SNOWFLAKE_AGENT_ARTIFACT_STAGE = $agentArtifactStage
$env:AGENT_INLINE_ARTIFACT_LIMIT_BYTES = $agentInlineArtifactLimit
$env:AGENT_ARTIFACT_DRAFT_RETENTION_DAYS = $agentArtifactRetention
$env:AGENT_CONTEXT_LIMIT_TOKENS = $agentContextLimit
$env:AGENT_THREAD_ROLLOVER_RATIO = $agentRolloverRatio
$env:AGENT_THREAD_HARD_RATIO = $agentHardRatio
$env:AGENT_RECENT_TURNS_TO_KEEP = $agentRecentTurns
$env:AGENT_MAX_TURNS_PER_SEGMENT = $agentMaxTurns
$env:PREPARED_WORKSPACE_CONTEXT_V2 = $preparedWorkspaceContextV2
$env:ASSISTANT_STREAMING_V2 = $assistantStreamingV2
$env:FIR_TARGET_MAPPING_PATTERNS_V2 = $firTargetMappingPatternsV2
$env:FIR_DURABLE_JOBS_V2 = $firDurableJobsV2
$env:PREPARED_CONTEXT_L1_IDLE_SECONDS = $preparedContextL1IdleSeconds
$env:PREPARED_CONTEXT_SOFT_REVALIDATE_SECONDS = $preparedContextSoftRevalidateSeconds
$env:PREPARED_CONTEXT_CLEANUP_DAYS = $preparedContextCleanupDays
$env:PREPARED_CONTEXT_DEBOUNCE_MS = $preparedContextDebounceMs
$env:SNOWFLAKE_PREPARED_WORKSPACE_CONTEXTS_TABLE = $preparedWorkspaceContextsTable
$env:SNOWFLAKE_TARGET_MAPPING_PATTERNS_TABLE = $targetMappingPatternsTable
$env:SNOWFLAKE_FIR_LEARNING_JOBS_TABLE = $firLearningJobsTable
$env:SNOWFLAKE_FIR_LEARNING_WORK_ITEMS_TABLE = $firLearningWorkItemsTable
$env:FIR_AGENT_REQUEST_TIMEOUT_SECONDS = $firAgentRequestTimeoutSeconds
$env:FIR_AGENT_MAX_ASSETS_PER_RUN = $firAgentMaxAssetsPerRun
$env:FIR_AGENT_MAX_PATTERNS_PER_BATCH = $firAgentMaxPatternsPerBatch
$env:FIR_AGENT_MAX_CONCURRENCY = $firAgentMaxConcurrency
$env:FIR_AGENT_RETRY_LIMIT = $firAgentRetryLimit
$env:FIR_JOB_MAX_RUNTIME_SECONDS = $firJobMaxRuntimeSeconds
$env:SNOWFLAKE_CONVERSATION_FEEDBACK_TABLE = $conversationFeedbackTable
$env:SNOWFLAKE_CONVERSATION_RECOMMENDATIONS_TABLE = $conversationRecommendationsTable
$env:SNOWFLAKE_RELATIONSHIP_FACTS_TABLE = $relationshipFactsTable
$env:SNOWFLAKE_RAG_DOCUMENTS_TABLE = $ragDocumentsTable
$env:SNOWFLAKE_RAG_SEARCH_SERVICE = $ragSearchService
$env:SNOWFLAKE_OAUTH_SESSIONS_TABLE = $oauthSessionsTable
$env:SNOWFLAKE_AGENT_ORCHESTRATION_MODEL = $agentModel
$env:CORS_ALLOWED_ORIGINS = $cors
$env:SNOWFLAKE_OAUTH_AUTHORIZE_URL = $oauthAuthorizeUrl
$env:SNOWFLAKE_OAUTH_TOKEN_URL = $oauthTokenUrl
$env:SNOWFLAKE_OAUTH_REDIRECT_URI = $oauthRedirectUri
$env:SNOWFLAKE_OAUTH_SCOPE = $oauthScope
$env:AUTH_SESSION_COOKIE_NAME = $authSessionCookieName
$env:AUTH_STATE_COOKIE_NAME = $authStateCookieName
$env:AUTH_SESSION_COOKIE_SECURE = $authSessionCookieSecure
$env:AUTH_SESSION_COOKIE_SAMESITE = $authSessionCookieSameSite
$env:AUTH_POST_LOGIN_REDIRECT_PATH = $authPostLoginRedirectPath
$env:AUTH_POST_LOGOUT_REDIRECT_PATH = $authPostLogoutRedirectPath
$env:AUTO_MAPPING_SERVICE_URL = $autoMappingServiceUrl
$env:AUTO_MAPPING_SERVICE_TIMEOUT_SECONDS = $autoMappingServiceTimeout
$env:AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS = $autoMappingServiceRetries
$env:AUTO_MAPPING_WORKER_MAX_CONCURRENCY = $autoMappingWorkerConcurrency
$env:AUTO_MAPPING_PROXY_BATCH_SIZE = $autoMappingProxyBatchSize
$env:AUTO_MAPPING_PROXY_MAX_IN_FLIGHT = $autoMappingProxyMaxInFlight
$env:AUTO_MAP_PIPELINE_V2 = $autoMapPipelineV2
$env:AGENT_SPEC_SOURCE_MAPPING_SHA256 = $agentSpecSourceMappingSha256
$env:AGENT_SPEC_TRANSFORMATION_RULE_SHA256 = $agentSpecTransformationRuleSha256
$env:SNOWFLAKE_SESSION_RETRY_ATTEMPTS = $snowflakeSessionRetries
$env:SNOWFLAKE_SESSION_RETRY_BACKOFF_SECONDS = $snowflakeSessionRetryBackoff
$env:SNOWFLAKE_USER_SESSION_CACHE_TTL_SECONDS = $snowflakeUserSessionCacheTtl
$env:SNOWFLAKE_AGENT_RETRY_ATTEMPTS = $snowflakeAgentRetries
$env:SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS = $snowflakeAgentRetryBackoff
$env:SNOWFLAKE_REST_HOST = if ($cfg.ContainsKey("SNOWFLAKE_REST_HOST") -and $cfg["SNOWFLAKE_REST_HOST"]) { $cfg["SNOWFLAKE_REST_HOST"] } else { "{0}.snowflakecomputing.com" -f $cfg["SNOWFLAKE_ACCOUNT"].ToLowerInvariant().Replace("_", "-") }

New-Item -ItemType Directory -Force -Path $ArtifactsDir | Out-Null

$RenderedSpec = Join-Path $ArtifactsDir ("webapp.{0}.yaml" -f $ImageTag)
$AutomapRenderedSpec = Join-Path $ArtifactsDir ("automap-worker.{0}.yaml" -f $ImageTag)

Invoke-Checked -Description "Rendering webapp service spec" -Command {
    & $PythonExe $RenderScript --template $SpecTemplate --output $RenderedSpec
}

if ($deployAutomap) {
    Invoke-Checked -Description "Rendering auto-mapping worker service spec" -Command {
        & $PythonExe $RenderScript --template $AutomapSpecTemplate --output $AutomapRenderedSpec
    }
}

Invoke-Checked -Description "Creating webapp service '$($cfg["WEBAPP_SERVICE_NAME"])' if needed" -Command {
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
}

Invoke-Checked -Description "Upgrading webapp service '$($cfg["WEBAPP_SERVICE_NAME"])'" -Command {
    & $SnowExe spcs service upgrade $cfg["WEBAPP_SERVICE_NAME"] `
        --connection $cfg["SNOWFLAKE_CONNECTION"] `
        --database $cfg["SNOWFLAKE_DATABASE"] `
        --schema $cfg["SNOWFLAKE_SCHEMA"] `
        --role $cfg["SNOWFLAKE_ROLE"] `
        --warehouse $cfg["SNOWFLAKE_WAREHOUSE"] `
        --spec-path $RenderedSpec `
        --format TABLE
}

Invoke-Checked -Description "Setting webapp scale to min=$webServiceMinInstances max=$webServiceMaxInstances" -Command {
    & $SnowExe sql -c $cfg["SNOWFLAKE_CONNECTION"] -q "ALTER SERVICE IF EXISTS $($cfg["SNOWFLAKE_DATABASE"]).$($cfg["SNOWFLAKE_SCHEMA"]).$($cfg["WEBAPP_SERVICE_NAME"]) SET MIN_INSTANCES=$webServiceMinInstances, MAX_INSTANCES=$webServiceMaxInstances;"
}

Invoke-Checked -Description "Listing webapp service endpoints" -Command {
    & $SnowExe spcs service list-endpoints $cfg["WEBAPP_SERVICE_NAME"] `
        --connection $cfg["SNOWFLAKE_CONNECTION"] `
        --database $cfg["SNOWFLAKE_DATABASE"] `
        --schema $cfg["SNOWFLAKE_SCHEMA"] `
        --role $cfg["SNOWFLAKE_ROLE"] `
        --warehouse $cfg["SNOWFLAKE_WAREHOUSE"] `
        --format TABLE
}

if ($deployAutomap) {
    Invoke-Checked -Description "Creating auto-mapping worker service '$($cfg["AUTO_MAPPING_SERVICE_NAME"])' if needed" -Command {
        & $SnowExe spcs service create $cfg["AUTO_MAPPING_SERVICE_NAME"] `
            --connection $cfg["SNOWFLAKE_CONNECTION"] `
            --database $cfg["SNOWFLAKE_DATABASE"] `
            --schema $cfg["SNOWFLAKE_SCHEMA"] `
            --role $cfg["SNOWFLAKE_ROLE"] `
            --warehouse $cfg["SNOWFLAKE_WAREHOUSE"] `
            --compute-pool $cfg["AUTO_MAPPING_COMPUTE_POOL"] `
            --spec-path $AutomapRenderedSpec `
            --eai-name $cfg["SNOWFLAKE_EGRESS_INTEGRATION"] `
            --if-not-exists `
            --format TABLE
    }

    Invoke-Checked -Description "Upgrading auto-mapping worker service '$($cfg["AUTO_MAPPING_SERVICE_NAME"])'" -Command {
        & $SnowExe spcs service upgrade $cfg["AUTO_MAPPING_SERVICE_NAME"] `
            --connection $cfg["SNOWFLAKE_CONNECTION"] `
            --database $cfg["SNOWFLAKE_DATABASE"] `
            --schema $cfg["SNOWFLAKE_SCHEMA"] `
            --role $cfg["SNOWFLAKE_ROLE"] `
            --warehouse $cfg["SNOWFLAKE_WAREHOUSE"] `
            --spec-path $AutomapRenderedSpec `
            --format TABLE
    }

    Invoke-Checked -Description "Setting auto-mapping worker scale to min=$automapServiceMinInstances max=$automapServiceMaxInstances" -Command {
        & $SnowExe sql -c $cfg["SNOWFLAKE_CONNECTION"] -q "ALTER SERVICE IF EXISTS $($cfg["SNOWFLAKE_DATABASE"]).$($cfg["SNOWFLAKE_SCHEMA"]).$($cfg["AUTO_MAPPING_SERVICE_NAME"]) SET MIN_INSTANCES=$automapServiceMinInstances, MAX_INSTANCES=$automapServiceMaxInstances;"
    }

    Invoke-Checked -Description "Listing auto-mapping worker endpoints" -Command {
        & $SnowExe spcs service list-endpoints $cfg["AUTO_MAPPING_SERVICE_NAME"] `
            --connection $cfg["SNOWFLAKE_CONNECTION"] `
            --database $cfg["SNOWFLAKE_DATABASE"] `
            --schema $cfg["SNOWFLAKE_SCHEMA"] `
            --role $cfg["SNOWFLAKE_ROLE"] `
            --warehouse $cfg["SNOWFLAKE_WAREHOUSE"] `
            --format TABLE
    }
} else {
    Write-Host ""
    Write-Host "AUTO_MAPPING_SERVICE_NAME is empty. Skipping separate Auto-map worker service deployment."
}

Write-Host ""
Write-Host "Deployment completed successfully."
Write-Host "Image tag: $ImageTag"
Write-Host "Webapp spec: $RenderedSpec"
if ($deployAutomap) {
    Write-Host "Auto-map spec: $AutomapRenderedSpec"
}
