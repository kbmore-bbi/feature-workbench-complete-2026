/**
 * Central registry for all backend API URL paths.
 * Import paths from here — do not hardcode URLs in services or components.
 */
export const API_ROUTES = {
  auth: {
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
  workbench: {
    invoke: '/v1/workbench/invoke',
    invokeStream: '/v1/workbench/invoke/stream',
    info: '/v1/workbench/info',
  },
} as const;

export type ApiRouteGroup = typeof API_ROUTES;
