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
  },
  derivedSources: {
    list: '/v1/derived-sources',
    validate: '/v1/derived-sources/validate',
    save: '/v1/derived-sources',
  },
  semanticContext: {
    refresh: '/v1/semantic-context/refresh',
  },
  projects: {
    list: '/v1/projects',
    summary: '/v1/projects/summary',
    create: '/v1/projects',
    sttms: (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}/sttms`,
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
  },
  upload: {
    sql: '/v1/upload/sql',
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
    agentGatewayWs: '/v1/workbench/agent/ws',
    autoMapJobs: '/v1/workbench/auto-map-jobs',
    autoMapDirect: '/v1/workbench/auto-map/direct',
    autoMapDirectStream: '/v1/workbench/auto-map/direct/stream',
    info: '/v1/workbench/info',
  },
} as const;

export type ApiRouteGroup = typeof API_ROUTES;
