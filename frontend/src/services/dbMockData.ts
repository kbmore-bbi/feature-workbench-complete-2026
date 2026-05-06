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

export function getMockAttributes(tables: string[]) {
  return tables.map((qualifiedName) => {
    const [database, schema, table] = qualifiedName.split(".");

    return {
      table: { database, schema, table },
      columns: [
        { column_name: "ID", data_type: "NUMBER" },
        { column_name: "CUSTOMER_KEY", data_type: "VARCHAR" },
        { column_name: "ORDER_DATE", data_type: "DATE" },
        { column_name: "AMOUNT", data_type: "NUMBER" },
      ],
    };
  });
}

export function mockDelay<T>(data: T, delay = 500): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(data), delay);
  });
}


