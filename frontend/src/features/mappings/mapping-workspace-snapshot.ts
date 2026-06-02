import type {
  ColumnGroup,
  MappingState,
  MappingWorkspaceSnapshot,
  TableNode,
} from '@/features/sttm/types/sttm.types';

const ORDERS_QN = 'SALES_DB.SALES_CORE.ORDERS';
const CUSTOMERS_QN = 'SALES_DB.SALES_CORE.CUSTOMERS';
const TARGET_QN = 'ENTERPRISE_DWH.PUBLISH.FACT_SALES_UNIFIED';

const sourceOrders: TableNode = {
  tableId: ORDERS_QN,
  tableName: 'ORDERS',
  qualifiedName: ORDERS_QN,
  isSelected: true,
  tag: 'TRANSACTIONAL',
  rows: '1.2M',
  columns: 5,
};

const sourceCustomers: TableNode = {
  tableId: CUSTOMERS_QN,
  tableName: 'CUSTOMERS',
  qualifiedName: CUSTOMERS_QN,
  isSelected: true,
  tag: 'MASTER',
  rows: '450K',
  columns: 4,
};

const targetTable: TableNode = {
  tableId: TARGET_QN,
  tableName: 'FACT_SALES_UNIFIED',
  qualifiedName: TARGET_QN,
  isSelected: true,
  tag: 'FACT',
  rows: '0',
  columns: 4,
};

const ordersAttributeGroup: ColumnGroup = {
  table: 'ORDERS',
  qualifiedName: ORDERS_QN,
  columns: [
    { name: 'ORDER_ID', type: 'NUMBER', isPrimaryKey: true },
    { name: 'CUSTOMER_ID', type: 'NUMBER', isForeignKey: true },
    { name: 'ORDER_DATE', type: 'DATE' },
    { name: 'ORDER_AMOUNT', type: 'NUMBER' },
    { name: 'STATUS', type: 'VARCHAR' },
  ],
};

const customersAttributeGroup: ColumnGroup = {
  table: 'CUSTOMERS',
  qualifiedName: CUSTOMERS_QN,
  columns: [
    { name: 'CUSTOMER_ID', type: 'NUMBER', isPrimaryKey: true },
    { name: 'CUSTOMER_NAME', type: 'VARCHAR' },
    { name: 'EMAIL', type: 'VARCHAR' },
    { name: 'COUNTRY_CODE', type: 'VARCHAR' },
  ],
};

const targetAttributeGroup: ColumnGroup = {
  table: 'FACT_SALES_UNIFIED',
  qualifiedName: TARGET_QN,
  columns: [
    { name: 'SALES_KEY', type: 'NUMBER', isPrimaryKey: true },
    { name: 'CUSTOMER_KEY', type: 'NUMBER', isForeignKey: true },
    { name: 'SALE_DATE', type: 'DATE' },
    { name: 'NET_AMOUNT', type: 'NUMBER' },
  ],
};

const filledMappings: MappingState[] = [
  {
    id: `${TARGET_QN}-0`,
    targetColumn: 'SALES_KEY',
    targetType: 'NUMBER',
    sourceColumn: 'ORDER_ID',
    sourceType: 'NUMBER',
    sourceColumns: [`${ORDERS_QN}.ORDER_ID`],
    expression: null,
    rule: 'Direct',
    status: 'MAPPED',
    nlRule: null,
    loadOrder: '1',
    description: 'Maps source order identifier to the unified sales key.',
    confidenceScore: 0.98,
  },
  {
    id: `${TARGET_QN}-1`,
    targetColumn: 'CUSTOMER_KEY',
    targetType: 'NUMBER',
    sourceColumn: 'CUSTOMER_ID',
    sourceType: 'NUMBER',
    sourceColumns: [`${CUSTOMERS_QN}.CUSTOMER_ID`],
    expression: null,
    rule: 'Direct',
    status: 'MAPPED',
    nlRule: null,
    loadOrder: '2',
    description: 'Maps customer master key from the Customers table.',
    confidenceScore: 0.96,
  },
  {
    id: `${TARGET_QN}-2`,
    targetColumn: 'SALE_DATE',
    targetType: 'DATE',
    sourceColumn: 'ORDER_DATE',
    sourceType: 'DATE',
    sourceColumns: [`${ORDERS_QN}.ORDER_DATE`],
    expression: null,
    rule: 'Direct',
    status: 'MAPPED',
    nlRule: null,
    loadOrder: '3',
    description: 'Direct date mapping from Orders with DATE_FORMAT normalization.',
    confidenceScore: 0.94,
  },
  {
    id: `${TARGET_QN}-3`,
    targetColumn: 'NET_AMOUNT',
    targetType: 'NUMBER',
    sourceColumn: 'ORDER_AMOUNT',
    sourceType: 'NUMBER',
    sourceColumns: [`${ORDERS_QN}.ORDER_AMOUNT`],
    expression: null,
    rule: 'Direct',
    status: 'MAPPED',
    nlRule: null,
    loadOrder: '4',
    description: 'Maps order amount to net sales amount on the unified fact.',
    confidenceScore: 0.91,
  },
];

export const DEFAULT_MAPPING_WORKSPACE_SNAPSHOT: MappingWorkspaceSnapshot = {
  sources: [sourceOrders, sourceCustomers],
  targets: [targetTable],
  sourceAttributeGroups: [ordersAttributeGroup, customersAttributeGroup],
  targetAttributeGroup,
  mappings: filledMappings,
  drivingTableId: ORDERS_QN,
  relationships: [
    {
      id: 'FK_ORDERS_CUSTOMERS',
      joinType: 'INNER',
      leftTableId: ORDERS_QN,
      rightTableId: CUSTOMERS_QN,
      constraintName: 'FK_ORDERS_CUSTOMERS',
      source: 'FOREIGN_KEY',
      locked: true,
      conditions: [
        {
          leftColumn: 'CUSTOMER_ID',
          operator: '=',
          rightColumn: 'CUSTOMER_ID',
        },
      ],
    },
  ],
};
