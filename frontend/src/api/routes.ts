/**
 * Central registry for all backend API URL paths.
 * Import paths from here — do not hardcode URLs in services or components.
 */
export const API_ROUTES = {
  auth: {
    login: '/v1/auth/login',
    callback: '/v1/auth/callback',
    logout: '/v1/auth/logout',
    session: '/v1/auth/session',
    permissions: '/v1/auth/permissions',
    snowflakeContext: '/v1/auth/snowflake-context',
  },
  user: {
    roles: '/v1/user/roles',
  },
  tableSelection: {
    databases: '/v1/table-selection/databases',
    schemas: '/v1/table-selection/schemas',
    tables: '/v1/table-selection/tables',
    attributes: '/v1/table-selection/attributes',
    relationships: '/v1/table-selection/relationships',
    relationshipReview: '/v1/table-selection/relationships/review',
  },
  derivedSources: {
    list: '/v1/derived-sources',
    validate: '/v1/derived-sources/validate',
    save: '/v1/derived-sources',
  },
  semanticContext: {
    refresh: '/v1/semantic-context/refresh',
  },
  bundleCuration: {
    get: (bundleVersionId: string) =>
      `/v1/workbench/bundle-curations/${encodeURIComponent(bundleVersionId)}`,
    preview: (bundleVersionId: string) =>
      `/v1/workbench/bundle-curations/${encodeURIComponent(bundleVersionId)}/preview`,
    promote: (bundleVersionId: string) =>
      `/v1/workbench/bundle-curations/${encodeURIComponent(bundleVersionId)}/promote`,
  },
  projects: {
    list: '/v1/projects',
    summary: '/v1/projects/summary',
    create: '/v1/projects',
    sttms: (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}/sttms`,
    attributes: (projectId: string) =>
      `/v1/projects/${encodeURIComponent(projectId)}/attributes`,
    attribute: (projectId: string, attributeId: string) =>
      `/v1/projects/${encodeURIComponent(projectId)}/attributes/${encodeURIComponent(attributeId)}`,
    importAttributes: (projectId: string) =>
      `/v1/projects/${encodeURIComponent(projectId)}/attributes/import`,
    precedentLinks: (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}/precedent-links`,
  },
  sttms: {
    get: (sttmId: string) => `/v1/sttms/${encodeURIComponent(sttmId)}`,
    autosave: (sttmId: string) => `/v1/sttms/${encodeURIComponent(sttmId)}/autosave`,
    publish: (sttmId: string) => `/v1/sttms/${encodeURIComponent(sttmId)}/publish`,
    precedentLinks: (sttmId: string) => `/v1/sttms/${encodeURIComponent(sttmId)}/precedent-links`,
  },
  testCases: {
    generate: '/v1/workbench/test-cases',
    jobs: '/v1/workbench/test-cases/jobs',
    job: (jobId: string) => `/v1/workbench/test-cases/jobs/${encodeURIComponent(jobId)}`,
  },
  dbtConversion: {
    jobs: '/v1/workbench/dbt-conversion/jobs',
    job: (jobId: string) => `/v1/workbench/dbt-conversion/jobs/${encodeURIComponent(jobId)}`,
  },
  upload: {
    sql: '/v1/upload/sql',
    sqlExplanations: (assetId: string) =>
      `/v1/upload/sql/${encodeURIComponent(assetId)}/explanations`,
    excel: '/v1/upload/excel',
    triggerLearning: '/v1/upload/trigger-learning',
  },
  notifications: {
    pending: '/v1/notifications/pending',
  },
  workbench: {
    invoke: '/v1/workbench/invoke',
    invokeStream: '/v1/workbench/invoke/stream',
    contextPrepare: '/v1/workbench/context/prepare',
    contextStatus: (contextId: string) =>
      `/v1/workbench/context/${encodeURIComponent(contextId)}`,
    firJob: (jobId: string) =>
      `/v1/workbench/fir/jobs/${encodeURIComponent(jobId)}`,
    firJobResume: (jobId: string) =>
      `/v1/workbench/fir/jobs/${encodeURIComponent(jobId)}/resume`,
    firPatterns: '/v1/workbench/fir/patterns',
    recommendations: '/v1/workbench/recommendations',
    recommendationPreview: (recommendationId: string) =>
      `/v1/workbench/recommendations/${encodeURIComponent(recommendationId)}/preview`,
    recommendationApply: (recommendationId: string) =>
      `/v1/workbench/recommendations/${encodeURIComponent(recommendationId)}/apply`,
    recommendationUndo: (recommendationId: string) =>
      `/v1/workbench/recommendations/${encodeURIComponent(recommendationId)}/undo`,
    recommendationFeedback: (recommendationId: string) =>
      `/v1/workbench/recommendations/${encodeURIComponent(recommendationId)}/feedback`,
    agentGatewayWs: '/v1/workbench/agent/ws',
    autoMapJobs: '/v1/workbench/auto-map-jobs',
    autoMapDirect: '/v1/workbench/auto-map/direct',
    autoMapDirectStream: '/v1/workbench/auto-map/direct/stream',
    info: '/v1/workbench/info',
  },
} as const;

export type ApiRouteGroup = typeof API_ROUTES;
