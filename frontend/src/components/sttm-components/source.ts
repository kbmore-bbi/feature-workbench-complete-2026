
export interface Table {
  tableId: string;
  tableName: string;
  isSelected: boolean;
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
  dbType: 'ORACLE' | 'POSTGRES' | 'MYSQL' | 'SNOWFLAKE';
  connectionId: string;
  isSelected: boolean;
  schemas: Schema[];
}

export interface SourceTargetSelectionModel {
  sources: Database[];
  targets: Database[];
}


export const DB_SCHEMA_TABLE_SELECTION: SourceTargetSelectionModel = {
  /* ===================== SOURCES ===================== */
  sources: [
    {
      dbId: 'SRC_DB_1',
      dbName: 'SALES_DB',
      dbType: 'ORACLE',
      connectionId: 'CONN_SALES_ORA',
      isSelected: true,
      schemas: [
        {
          schemaId: 'SRC_SCH_1',
          schemaName: 'SALES_CORE',
          isSelected: true,
          tables: [
            {
              tableId: 'SRC_TBL_1',
              tableName: 'ORDERS',
              isSelected: true
            },
            {
              tableId: 'SRC_TBL_2',
              tableName: 'CUSTOMERS',
              isSelected: true
            }
          ]
        },
        {
          schemaId: 'SRC_SCH_2',
          schemaName: 'SALES_REF',
          isSelected: false,
          tables: [
            {
              tableId: 'SRC_TBL_3',
              tableName: 'COUNTRY',
              isSelected: false
            }
          ]
        }
      ]
    },
    {
      dbId: 'SRC_DB_2',
      dbName: 'FINANCE_DB',
      dbType: 'POSTGRES',
      connectionId: 'CONN_FIN_PG',
      isSelected: true,
      schemas: [
        {
          schemaId: 'SRC_SCH_3',
          schemaName: 'FIN_CORE',
          isSelected: true,
          tables: [
            {
              tableId: 'SRC_TBL_4',
              tableName: 'PAYMENTS',
              isSelected: true
            }
          ]
        }
      ]
    }
  ],

  /* ===================== TARGETS ===================== */
  targets: [
    {
      dbId: 'TGT_DB_1',
      dbName: 'ENTERPRISE_DWH',
      dbType: 'SNOWFLAKE',
      connectionId: 'CONN_DWH_SNOW',
      isSelected: true,          // ✅ Only one DB selected
      schemas: [
        {
          schemaId: 'TGT_SCH_1',
          schemaName: 'DWH_SALES',
          isSelected: true,       // ✅ Only one schema selected
          tables: [
            {
              tableId: 'TGT_TBL_1',
              tableName: 'SALES_FACT',
              isSelected: true    // ✅ Only one table selected
            }
          ]
        }
      ]
    },

    /* Available but NOT selected (optional for UI) */
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
            {
              tableId: 'TGT_TBL_2',
              tableName: 'SALES_SUMMARY',
              isSelected: false
            }
          ]
        }
      ]
    }
  ]
};
