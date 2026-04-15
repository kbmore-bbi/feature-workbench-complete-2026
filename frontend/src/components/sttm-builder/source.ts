export interface Table {
  tableId: string;
  tableName: string;
  isSelected: boolean;
  tag: string;      // e.g., 'Transactional', 'Core'
  rows: string;     // e.g., '1.2M'
  columns: number;  // e.g., 6
}

export interface Schema {
  schemaId: string;
  schemaName: string;
  isSelected: boolean;
  tables: Table[];
}

export interface Database {
  dbId: string;
  dbName: string;
  dbType: 'ORACLE' | 'POSTGRES' | 'MYSQL' | 'SNOWFLAKE' | 'SQL SERVER';
  connectionId: string;
  isSelected: boolean;
  schemas: Schema[];
}

export const DB_SCHEMA_TABLE_SELECTION: any = {
  /* ===================== SOURCES (Multiple DBs & Schemas) ===================== */
  sources: [
    {
      dbId: 'SRC_DB_1',
      dbName: 'CRM_PROD',
      dbType: 'SQL SERVER',
      connectionId: 'CONN_CRM_01',
      isSelected: false,
      schemas: [
        {
          schemaId: 'SRC_SCH_1',
          schemaName: 'dbo',
          isSelected: false,
          tables: [
            { tableId: 'T1', tableName: 'Orders', tag: 'Sales', rows: '1.2M', columns: 8, isSelected: false },
            { tableId: 'T2', tableName: 'Customers', tag: 'Master', rows: '450K', columns: 12, isSelected: false },
            { tableId: 'T3', tableName: 'Invoices', tag: 'Billing', rows: '800K', columns: 15, isSelected: false },
            { tableId: 'T4', tableName: 'Products', tag: 'Core', rows: '15K', columns: 10, isSelected: false },
            { tableId: 'T8', tableName: 'Order_Items', tag: 'Sales', rows: '4.5M', columns: 6, isSelected: false },
            { tableId: 'T9', tableName: 'Payments', tag: 'Billing', rows: '900K', columns: 7, isSelected: false }
          ]
        },
        {
          schemaId: 'SRC_SCH_5',
          schemaName: 'inventory',
          isSelected: false,
          tables: [
            { tableId: 'T10', tableName: 'Stock_Levels', tag: 'Warehouse', rows: '50K', columns: 4, isSelected: false },
            { tableId: 'T11', tableName: 'Suppliers', tag: 'Vendor', rows: '1.2K', columns: 9, isSelected: false },
            { tableId: 'T12', tableName: 'Shipments', tag: 'Logistics', rows: '200K', columns: 11, isSelected: false }
          ]
        }
      ]
    },
    {
      dbId: 'SRC_DB_2',
      dbName: 'MARKETING_DB',
      dbType: 'POSTGRES',
      connectionId: 'CONN_MKT_PG',
      isSelected: false,
      schemas: [
        {
          schemaId: 'SRC_SCH_2',
          schemaName: 'public',
          isSelected: false,
          tables: [
            { tableId: 'T5', tableName: 'Campaigns', tag: 'Leads', rows: '2M', columns: 24, isSelected: false },
            { tableId: 'T6', tableName: 'Ad_Spend', tag: 'Finance', rows: '500K', columns: 5, isSelected: false },
            { tableId: 'T13', tableName: 'Web_Clicks', tag: 'Analytics', rows: '50M', columns: 4, isSelected: false },
            { tableId: 'T14', tableName: 'Email_Logs', tag: 'CRM', rows: '12M', columns: 8, isSelected: false }
          ]
        },
        {
          schemaId: 'SRC_SCH_6',
          schemaName: 'social_media',
          isSelected: false,
          tables: [
            { tableId: 'T15', tableName: 'Twitter_Posts', tag: 'Social', rows: '10M', columns: 6, isSelected: false },
            { tableId: 'T16', tableName: 'FB_Audience', tag: 'Social', rows: '3M', columns: 14, isSelected: false }
          ]
        }
      ]
    },
    {
      dbId: 'SRC_DB_3',
      dbName: 'HR_SYSTEM',
      dbType: 'ORACLE',
      connectionId: 'CONN_HR_ORA',
      isSelected: false,
      schemas: [
        {
          schemaId: 'SRC_SCH_7',
          schemaName: 'HR_CORE',
          isSelected: false,
          tables: [
            { tableId: 'T17', tableName: 'Employees', tag: 'Staff', rows: '5K', columns: 22, isSelected: false },
            { tableId: 'T18', tableName: 'Departments', tag: 'Org', rows: '100', columns: 4, isSelected: false },
            { tableId: 'T19', tableName: 'Payroll_History', tag: 'Finance', rows: '250K', columns: 12, isSelected: false }
          ]
        }
      ]
    }
  ],

  /* ===================== TARGETS (Selection restricted to 1 DB/Schema/Table) ===================== */
  targets: [
    {
      dbId: 'TGT_DB_1',
      dbName: 'SNOWFLAKE_DWH',
      dbType: 'SNOWFLAKE',
      connectionId: 'CONN_SNOW_01',
      isSelected: false,
      schemas: [
        {
          schemaId: 'TGT_SCH_1',
          schemaName: 'RAW_STAGE',
          isSelected: false,
          tables: [
            { tableId: 'T7', tableName: 'STG_Orders', tag: 'Staging', rows: '0', columns: 8, isSelected: false },
            { tableId: 'T20', tableName: 'STG_Customers', tag: 'Staging', rows: '0', columns: 12, isSelected: false },
            { tableId: 'T21', tableName: 'STG_Invoices', tag: 'Staging', rows: '0', columns: 15, isSelected: false }
          ]
        },
        {
          schemaId: 'TGT_SCH_3',
          schemaName: 'ANALYTICS_PROD',
          isSelected: false,
          tables: [
            { tableId: 'T22', tableName: 'FACT_Sales', tag: 'Prod', rows: '0', columns: 30, isSelected: false },
            { tableId: 'T23', tableName: 'DIM_Geography', tag: 'Prod', rows: '0', columns: 10, isSelected: false }
          ]
        }
      ]
    },
    {
      dbId: 'TGT_DB_2',
      dbName: 'REPORTING_DB',
      dbType: 'POSTGRES',
      connectionId: 'CONN_REP_PG',
      isSelected: false,
      schemas: [
        {
          schemaId: 'TGT_SCH_2',
          schemaName: 'RPT_SALES',
          isSelected: false,
          tables: [
            { tableId: 'T24', tableName: 'Monthly_Summary', tag: 'Report', rows: '12K', columns: 10, isSelected: false },
            { tableId: 'T25', tableName: 'Regional_Stats', tag: 'Report', rows: '5K', columns: 8, isSelected: false }
          ]
        }
      ]
    }
  ]
};

