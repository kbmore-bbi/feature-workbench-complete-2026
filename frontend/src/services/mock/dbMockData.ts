type TableRef = { database: string; schema: string; table: string };

export const mockDatabases = [
  { database_name: "SALES_DB" },
  { database_name: "FINANCE_DB" },
  { database_name: "ENTERPRISE_DWH" },
  { database_name: "CUSTOMER_360" },
  { database_name: "SUPPLY_CHAIN" },
  { database_name: "RISK_COMPLIANCE" },
];

export const mockSchemasByDatabase: Record<string, Array<{ schema_name: string }>> = {
  SALES_DB: [
    { schema_name: "SALES_CORE" },
    { schema_name: "SALES_REF" },
    { schema_name: "SALES_STAGING" },
  ],
  FINANCE_DB: [
    { schema_name: "FIN_CORE" },
    { schema_name: "FIN_REF" },
  ],
  ENTERPRISE_DWH: [
    { schema_name: "DWH_SALES" },
    { schema_name: "PUBLISH" },
    { schema_name: "DWH_FINANCE" },
    { schema_name: "DWH_CUSTOMER" },
  ],
  CUSTOMER_360: [
    { schema_name: "MDM" },
    { schema_name: "PROFILE" },
    { schema_name: "CONSENT" },
  ],
  SUPPLY_CHAIN: [
    { schema_name: "PROCUREMENT" },
    { schema_name: "INVENTORY" },
    { schema_name: "LOGISTICS" },
  ],
  RISK_COMPLIANCE: [
    { schema_name: "AML" },
    { schema_name: "KYC" },
  ],
};

export const mockTablesBySchema: Record<string, Array<{ table_name: string }>> = {
  "SALES_DB.SALES_CORE": [
    { table_name: "ORDERS" },
    { table_name: "CUSTOMERS" },
    { table_name: "ORDER_ITEMS" },
    { table_name: "PRODUCTS" },
    { table_name: "RETURNS" },
    { table_name: "PROMOTIONS" },
  ],
  "SALES_DB.SALES_REF": [{ table_name: "COUNTRY" }],
  "SALES_DB.SALES_STAGING": [
    { table_name: "STG_ORDERS" },
    { table_name: "STG_CUSTOMERS" },
  ],
  "FINANCE_DB.FIN_CORE": [{ table_name: "PAYMENTS" }],
  "FINANCE_DB.FIN_REF": [
    { table_name: "CURRENCY" },
    { table_name: "EXCHANGE_RATES" },
  ],
  "ENTERPRISE_DWH.DWH_SALES": [
    { table_name: "FACT_SALES" },
    { table_name: "DIM_CUSTOMER" },
    { table_name: "DIM_PRODUCT" },
    { table_name: "DIM_DATE" },
  ],
  "ENTERPRISE_DWH.PUBLISH": [{ table_name: "FACT_SALES_UNIFIED" }],
  "ENTERPRISE_DWH.DWH_FINANCE": [
    { table_name: "FACT_PAYMENTS" },
    { table_name: "DIM_ACCOUNT" },
    { table_name: "DIM_CURRENCY" },
  ],
  "ENTERPRISE_DWH.DWH_CUSTOMER": [
    { table_name: "DIM_CUSTOMER_MASTER" },
    { table_name: "BRIDGE_CUSTOMER_ID" },
  ],
  "CUSTOMER_360.MDM": [
    { table_name: "MASTER_CUSTOMER" },
    { table_name: "MASTER_ADDRESS" },
    { table_name: "MASTER_CONTACT" },
  ],
  "CUSTOMER_360.PROFILE": [
    { table_name: "CUSTOMER_PROFILE" },
    { table_name: "CUSTOMER_SEGMENT" },
  ],
  "CUSTOMER_360.CONSENT": [
    { table_name: "CONSENT_EVENTS" },
    { table_name: "CONSENT_STATUS" },
  ],
  "SUPPLY_CHAIN.PROCUREMENT": [
    { table_name: "PURCHASE_ORDERS" },
    { table_name: "VENDORS" },
  ],
  "SUPPLY_CHAIN.INVENTORY": [
    { table_name: "STOCK_LEVELS" },
    { table_name: "WAREHOUSES" },
    { table_name: "SKU" },
  ],
  "SUPPLY_CHAIN.LOGISTICS": [
    { table_name: "SHIPMENTS" },
    { table_name: "CARRIERS" },
    { table_name: "DELIVERY_EVENTS" },
  ],
  "RISK_COMPLIANCE.AML": [
    { table_name: "AML_ALERTS" },
    { table_name: "TRANSACTION_MONITORING" },
  ],
  "RISK_COMPLIANCE.KYC": [
    { table_name: "KYC_CASES" },
    { table_name: "CUSTOMER_DOCUMENTS" },
  ],
};

const tableKey = (ref: TableRef) => `${ref.database}.${ref.schema}.${ref.table}`;

export const mockRelationships = [
  {
    id: "FK_ORDERS_CUSTOMERS",
    left_table: { database: "SALES_DB", schema: "SALES_CORE", table: "ORDERS" },
    right_table: { database: "SALES_DB", schema: "SALES_CORE", table: "CUSTOMERS" },
    constraint_name: "FK_ORDERS_CUSTOMERS",
    join_type: "INNER" as const,
    source: "FOREIGN_KEY" as const,
    locked: true,
    conditions: [{ left_column: "CUSTOMER_ID", right_column: "CUSTOMER_ID", operator: "=" }],
  },
  {
    id: "FK_ORDER_ITEMS_ORDERS",
    left_table: { database: "SALES_DB", schema: "SALES_CORE", table: "ORDER_ITEMS" },
    right_table: { database: "SALES_DB", schema: "SALES_CORE", table: "ORDERS" },
    constraint_name: "FK_ORDER_ITEMS_ORDERS",
    join_type: "INNER" as const,
    source: "FOREIGN_KEY" as const,
    locked: true,
    conditions: [{ left_column: "ORDER_ID", right_column: "ORDER_ID", operator: "=" }],
  },
  {
    id: "FK_FACT_SALES_DIM_CUSTOMER",
    left_table: { database: "ENTERPRISE_DWH", schema: "DWH_SALES", table: "FACT_SALES" },
    right_table: { database: "ENTERPRISE_DWH", schema: "DWH_SALES", table: "DIM_CUSTOMER" },
    constraint_name: "FK_FACT_SALES_DIM_CUSTOMER",
    join_type: "LEFT" as const,
    source: "FOREIGN_KEY" as const,
    locked: true,
    conditions: [{ left_column: "CUSTOMER_KEY", right_column: "CUSTOMER_KEY", operator: "=" }],
  },
];

export function getMockRelationships(
  tables: TableRef[],
): typeof mockRelationships {
  const selected = new Set(tables.map(tableKey));
  return mockRelationships.filter(
    (relationship) =>
      selected.has(tableKey(relationship.left_table)) &&
      selected.has(tableKey(relationship.right_table)),
  );
}

const defaultColumnsByTable: Record<string, Array<{ column_name: string; data_type: string; is_primary_key?: boolean; is_foreign_key?: boolean }>> = {
  ORDERS: [
    { column_name: "ORDER_ID", data_type: "NUMBER", is_primary_key: true },
    { column_name: "CUSTOMER_ID", data_type: "NUMBER", is_foreign_key: true },
    { column_name: "ORDER_DATE", data_type: "DATE" },
    { column_name: "ORDER_AMOUNT", data_type: "NUMBER" },
    { column_name: "STATUS", data_type: "VARCHAR" },
  ],
  CUSTOMERS: [
    { column_name: "CUSTOMER_ID", data_type: "NUMBER", is_primary_key: true },
    { column_name: "CUSTOMER_NAME", data_type: "VARCHAR" },
    { column_name: "EMAIL", data_type: "VARCHAR" },
    { column_name: "COUNTRY_CODE", data_type: "VARCHAR" },
  ],
  ORDER_ITEMS: [
    { column_name: "ORDER_ITEM_ID", data_type: "NUMBER", is_primary_key: true },
    { column_name: "ORDER_ID", data_type: "NUMBER", is_foreign_key: true },
    { column_name: "PRODUCT_ID", data_type: "NUMBER", is_foreign_key: true },
    { column_name: "QUANTITY", data_type: "NUMBER" },
    { column_name: "LINE_AMOUNT", data_type: "NUMBER" },
  ],
  FACT_SALES: [
    { column_name: "SALES_KEY", data_type: "NUMBER", is_primary_key: true },
    { column_name: "CUSTOMER_KEY", data_type: "NUMBER", is_foreign_key: true },
    { column_name: "PRODUCT_KEY", data_type: "NUMBER", is_foreign_key: true },
    { column_name: "SALE_DATE", data_type: "DATE" },
    { column_name: "NET_AMOUNT", data_type: "NUMBER" },
  ],
  DIM_CUSTOMER: [
    { column_name: "CUSTOMER_KEY", data_type: "NUMBER", is_primary_key: true },
    { column_name: "CUSTOMER_NAME", data_type: "VARCHAR" },
    { column_name: "SEGMENT", data_type: "VARCHAR" },
    { column_name: "COUNTRY", data_type: "VARCHAR" },
  ],
};

export function getMockAttributes(tables: string[]) {
  return tables.map((qualifiedName) => {
    const [database, schema, table] = qualifiedName.split(".");

    return {
      table: { database, schema, table },
      columns:
        defaultColumnsByTable[table] ?? [
          { column_name: "ID", data_type: "NUMBER", is_primary_key: true },
          { column_name: "CUSTOMER_KEY", data_type: "VARCHAR" },
          { column_name: "ORDER_DATE", data_type: "DATE" },
          { column_name: "AMOUNT", data_type: "NUMBER" },
        ],
    };
  });
}

type RelationshipItem = {
  id?: string;
  left_table: TableRef;
  right_table: TableRef;
  join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL";
  constraint_name?: string | null;
  source?: "FOREIGN_KEY" | "USER_DEFINED" | null;
  locked?: boolean;
  conditions?: Array<{
    left_column: string;
    right_column: string;
    operator?: string;
  }>;
};

type SemanticLevel =
  | "L0_RELATIONSHIP"
  | "L1_CONTEXT"
  | "L2_ANALYST_READY"
  | "L3_MAPPING_ENRICHED";

type DerivedSourceRecord = {
  derived_source_id: string;
  derived_source_name: string;
  sql_text: string;
  source_tables: TableRef[];
  parent_derived_source_ids?: string[];
  driving_table?: TableRef | null;
  relationships?: RelationshipItem[];
  filters?: unknown[];
  selected_columns_by_table?: Record<string, string[]>;
  preview_columns?: Array<{ name: string; data_type: string; is_primary_key?: boolean }>;
  base_source_tables?: TableRef[];
  lineage_depth?: number;
  semantic_bundle_id?: string | null;
  semantic_view_name?: string | null;
  semantic_level?: string | null;
  upstream_hash?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_active?: boolean;
};

const seedDerivedSources: DerivedSourceRecord[] = [
  {
    derived_source_id: "ds-mock-customer-orders",
    derived_source_name: "Customer Order Summary",
    sql_text:
      "SELECT c.CUSTOMER_ID, c.CUSTOMER_NAME, COUNT(o.ORDER_ID) AS ORDER_COUNT\nFROM SALES_DB.SALES_CORE.CUSTOMERS c\nLEFT JOIN SALES_DB.SALES_CORE.ORDERS o ON c.CUSTOMER_ID = o.CUSTOMER_ID\nGROUP BY 1, 2",
    source_tables: [
      { database: "SALES_DB", schema: "SALES_CORE", table: "CUSTOMERS" },
      { database: "SALES_DB", schema: "SALES_CORE", table: "ORDERS" },
    ],
    driving_table: { database: "SALES_DB", schema: "SALES_CORE", table: "CUSTOMERS" },
    relationships: [
      {
        id: "FK_ORDERS_CUSTOMERS",
        left_table: { database: "SALES_DB", schema: "SALES_CORE", table: "ORDERS" },
        right_table: { database: "SALES_DB", schema: "SALES_CORE", table: "CUSTOMERS" },
        join_type: "LEFT",
        source: "FOREIGN_KEY",
        locked: true,
        conditions: [{ left_column: "CUSTOMER_ID", right_column: "CUSTOMER_ID", operator: "=" }],
      },
    ],
    selected_columns_by_table: {
      "SALES_DB.SALES_CORE.CUSTOMERS": ["CUSTOMER_ID", "CUSTOMER_NAME"],
      "SALES_DB.SALES_CORE.ORDERS": ["ORDER_ID"],
    },
    preview_columns: [
      { name: "CUSTOMER_ID", data_type: "NUMBER", is_primary_key: true },
      { name: "CUSTOMER_NAME", data_type: "VARCHAR" },
      { name: "ORDER_COUNT", data_type: "NUMBER" },
    ],
    semantic_bundle_id: "mock-bundle-001",
    semantic_view_name: "MOCK_CUSTOMER_ORDER_SUMMARY",
    semantic_level: "L2_ANALYST_READY",
    lineage_depth: 1,
    is_active: true,
  },
];

let mockDerivedSourceStore: DerivedSourceRecord[] = [...seedDerivedSources];

export function listMockDerivedSources(): DerivedSourceRecord[] {
  return mockDerivedSourceStore.map((item) => ({ ...item }));
}

type DerivedSourcePayload = {
  derived_source_id?: string | null;
  derived_source_name: string;
  sql_text: string;
  source_tables: TableRef[];
  parent_derived_source_ids?: string[];
  driving_table?: TableRef | null;
  relationships?: RelationshipItem[];
  filters?: unknown[];
  selected_columns_by_table?: Record<string, string[]>;
};

export function buildMockValidateDerivedSource(payload: DerivedSourcePayload) {
  const columnNames = Object.values(payload.selected_columns_by_table ?? {}).flat();
  const previewColumns =
    columnNames.length > 0
      ? columnNames.map((name) => ({ name, data_type: "VARCHAR", is_primary_key: name.endsWith("_ID") }))
      : [{ name: "CUSTOMER_ID", data_type: "NUMBER", is_primary_key: true }];

  return {
    valid: true,
    message: "Mock SQL validation succeeded (local dev data).",
    preview_columns: previewColumns,
    preview_rows: [
      {
        values: Object.fromEntries(
          previewColumns.map((column, index) => [column.name, index + 1]),
        ),
      },
    ],
  };
}

export function saveMockDerivedSource(payload: DerivedSourcePayload): DerivedSourceRecord {
  const derivedSourceId =
    payload.derived_source_id?.trim() || `ds-mock-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const record: DerivedSourceRecord = {
    ...payload,
    derived_source_id: derivedSourceId,
    preview_columns: buildMockValidateDerivedSource(payload).preview_columns,
    base_source_tables: payload.source_tables,
    lineage_depth: (payload.parent_derived_source_ids?.length ?? 0) + 1,
    semantic_bundle_id: "mock-bundle-001",
    semantic_view_name: `MOCK_${payload.derived_source_name.replace(/\s+/g, "_").toUpperCase()}`,
    semantic_level: "L2_ANALYST_READY",
    upstream_hash: "mock-upstream-hash",
    created_by: "mock-dev-user",
    created_at: now,
    updated_at: now,
    is_active: true,
  };

  const existingIndex = mockDerivedSourceStore.findIndex(
    (item) => item.derived_source_id === derivedSourceId,
  );
  if (existingIndex >= 0) {
    mockDerivedSourceStore[existingIndex] = record;
  } else {
    mockDerivedSourceStore.push(record);
  }

  return { ...record };
}

type SemanticContextRefreshPayload = {
  selected_source_tables: TableRef[];
  selected_derived_sources?: string[];
  target_table?: TableRef | null;
  relationships?: Array<Record<string, unknown>>;
  requested_level?: SemanticLevel;
  force?: boolean;
};

export function buildMockSemanticContextRefresh(payload: SemanticContextRefreshPayload) {
  const requestedLevel: SemanticLevel = payload.requested_level ?? "L1_CONTEXT";
  return {
    bundle_id: "mock-bundle-001",
    bundle_hash: "mock-bundle-hash",
    bundle_label: "Mock semantic bundle",
    requested_level: requestedLevel,
    achieved_level: requestedLevel,
    semantic_view_name: "MOCK_SEMANTIC_VIEW",
    status: "ready" as const,
    promoted: false,
    cache_hit: true,
    summary: {
      source_table_count: payload.selected_source_tables.length,
      derived_source_count: payload.selected_derived_sources?.length ?? 0,
      relationship_count: payload.relationships?.length ?? 0,
      mode: "mock",
    },
    lineage: [],
    semantic_context: payload.selected_source_tables.map((table) => ({
      table,
      semantic_model: { mode: "mock" },
      scope: "dev",
    })),
    datahub_context: { status: "mock-unavailable" },
  };
}
