/**
 * Static test case data for the Test Cases tab.
 * TODO: replace with API response once the test generation endpoint is available.
 */

export type TestCaseType = 'Positive' | 'Negative';

export type TestCaseConfidence = 'High' | 'Medium' | 'Low';

export type TestSuiteKey =
  | 'null-checks'
  | 'range-validations'
  | 'referential-integrity'
  | 'transformation-rules';

export type SttmTestCase = {
  id: string;
  name: string;
  targetAttribute: string;
  sourceColumn: string;
  /** Each entry renders as one rule chip (joins span multiple chips). */
  mappingRule: string[];
  description: string;
  testType: TestCaseType;
  sampleSourceInput: string;
  expectedTargetValue: string;
  confidence: TestCaseConfidence;
  suite: TestSuiteKey;
};

export const TEST_SUITE_LABELS: Record<TestSuiteKey, string> = {
  'null-checks': 'Null Checks',
  'range-validations': 'Range Validations',
  'referential-integrity': 'Referential Integrity',
  'transformation-rules': 'Transformation Rules',
};

export const STATIC_TEST_CASES: SttmTestCase[] = [
  {
    id: 'TC-001',
    name: 'ORDER_ID not null in target',
    targetAttribute: 'ORDER_ID',
    sourceColumn: 'ORDER_ID',
    mappingRule: ['Direct'],
    description: 'Verify ORDER_ID arrives as non-null for every loaded row.',
    testType: 'Negative',
    sampleSourceInput: '10001',
    expectedTargetValue: '10001',
    confidence: 'High',
    suite: 'null-checks',
  },
  {
    id: 'TC-002',
    name: 'CUST_ID not null in target',
    targetAttribute: 'CUSTOMER_KEY',
    sourceColumn: 'CUST_ID',
    mappingRule: ['Direct'],
    description: 'Verify CUST_ID arrives as non-null for every loaded row.',
    testType: 'Negative',
    sampleSourceInput: '2047',
    expectedTargetValue: '2047',
    confidence: 'High',
    suite: 'null-checks',
  },
  {
    id: 'TC-003',
    name: 'DATE_KEY not null in target',
    targetAttribute: 'DATE_KEY',
    sourceColumn: 'DATE_KEY',
    mappingRule: ['Direct'],
    description: 'Verify DATE_KEY arrives as non-null for every loaded row.',
    testType: 'Negative',
    sampleSourceInput: '20240115',
    expectedTargetValue: '20240115',
    confidence: 'High',
    suite: 'null-checks',
  },
  {
    id: 'TC-004',
    name: 'AMOUNT not null in target',
    targetAttribute: 'AMOUNT',
    sourceColumn: 'AMOUNT',
    mappingRule: ['Direct'],
    description: 'Verify AMOUNT arrives as non-null for every loaded row.',
    testType: 'Negative',
    sampleSourceInput: '1240.50',
    expectedTargetValue: '1240.50',
    confidence: 'High',
    suite: 'null-checks',
  },
  {
    id: 'TC-005',
    name: 'ORDER_ID within valid range',
    targetAttribute: 'ORDER_ID',
    sourceColumn: 'ORDER_ID',
    mappingRule: ['Direct'],
    description: 'Verify ORDER_ID value falls within the allowed business range.',
    testType: 'Negative',
    sampleSourceInput: '10001',
    expectedTargetValue: '10001 (> 0 AND < 1,000,000)',
    confidence: 'Medium',
    suite: 'range-validations',
  },
  {
    id: 'TC-006',
    name: 'CUSTOMER_KEY within valid range',
    targetAttribute: 'CUSTOMER_KEY',
    sourceColumn: 'CUST_ID',
    mappingRule: ['Direct'],
    description: 'Verify CUST_ID value falls within the allowed business range.',
    testType: 'Negative',
    sampleSourceInput: '2047',
    expectedTargetValue: '2047 (> 0 AND < 1,000,000)',
    confidence: 'Medium',
    suite: 'range-validations',
  },
  {
    id: 'TC-007',
    name: 'CUST_ID resolves in Customers',
    targetAttribute: 'CUST_ID',
    sourceColumn: 'CUST_ID',
    mappingRule: ['INNER JOIN ON', 'CUST_ID =', 'CUST_ID'],
    description: 'Every CUST_ID in source must have a matching Customers record.',
    testType: 'Negative',
    sampleSourceInput: '2047',
    expectedTargetValue: 'Matching record found',
    confidence: 'High',
    suite: 'referential-integrity',
  },
  {
    id: 'TC-008',
    name: 'Orders.CUST_ID uniqueness',
    targetAttribute: 'CUST_ID',
    sourceColumn: 'CUST_ID',
    mappingRule: ['UNIQUE KEY'],
    description: 'CUST_ID must have no duplicate values per business key.',
    testType: 'Negative',
    sampleSourceInput: '2047',
    expectedTargetValue: '1 occurrence per key',
    confidence: 'High',
    suite: 'referential-integrity',
  },
  {
    id: 'TC-009',
    name: 'DATE_KEY formatted as YYYYMMDD',
    targetAttribute: 'DATE_KEY',
    sourceColumn: 'ORDER_DATE',
    mappingRule: ['DATE_FORMAT'],
    description: 'Confirm ORDER_DATE transforms into the numeric YYYYMMDD date key.',
    testType: 'Positive',
    sampleSourceInput: '2024-01-15',
    expectedTargetValue: '20240115',
    confidence: 'High',
    suite: 'transformation-rules',
  },
  {
    id: 'TC-010',
    name: 'AMOUNT rounded to 2 decimals',
    targetAttribute: 'AMOUNT',
    sourceColumn: 'GROSS_AMOUNT',
    mappingRule: ['CAST'],
    description: 'Validate GROSS_AMOUNT casts to NUMBER(12,2) with correct rounding.',
    testType: 'Positive',
    sampleSourceInput: '1240.499',
    expectedTargetValue: '1240.50',
    confidence: 'Medium',
    suite: 'transformation-rules',
  },
];

export const TEST_CASE_RECOMMENDATIONS = [
  'Run critical tests before each ETL load',
  'Schedule row-count checks post-load',
  'Add range checks for numeric columns',
  'Enforce PK uniqueness at DB level',
];

export type SampleDataColumn = {
  key: string;
  source: string;
  target: string;
};

export type SampleDataValue = {
  raw: string;
  /** Transformed target value rendered below the raw value (e.g. UPPER on REGION). */
  transformed?: string;
};

export type SampleDataRow = Record<string, SampleDataValue>;

export const SAMPLE_DATA_META = {
  sourceTable: 'SALES.Orders',
  sampleRows: 5,
  mappedColumns: 7,
};

export const SAMPLE_DATA_COLUMNS: SampleDataColumn[] = [
  { key: 'orderId', source: 'ORDER_ID', target: 'ORDER_ID' },
  { key: 'custId', source: 'CUST_ID', target: 'CUSTOMER_KEY' },
  { key: 'dateKey', source: 'DATE_KEY', target: 'DATE_KEY' },
  { key: 'amount', source: 'AMOUNT', target: 'AMOUNT' },
  { key: 'quantity', source: 'QUANTITY', target: 'QUANTITY' },
  { key: 'discount', source: 'DISCOUNT', target: 'DISCOUNT' },
  { key: 'region', source: 'REGION', target: 'REGION' },
];

export const SAMPLE_DATA_ROWS: SampleDataRow[] = [
  {
    orderId: { raw: '10001' },
    custId: { raw: '2047' },
    dateKey: { raw: '20240115' },
    amount: { raw: '1240.50' },
    quantity: { raw: '3' },
    discount: { raw: '0.10' },
    region: { raw: 'Northeast', transformed: 'NORTHEAST' },
  },
  {
    orderId: { raw: '10002' },
    custId: { raw: '3812' },
    dateKey: { raw: '20240116' },
    amount: { raw: '560.00' },
    quantity: { raw: '1' },
    discount: { raw: '0.00' },
    region: { raw: 'Southwest', transformed: 'SOUTHWEST' },
  },
  {
    orderId: { raw: '10003' },
    custId: { raw: '1199' },
    dateKey: { raw: '20240116' },
    amount: { raw: '3890.75' },
    quantity: { raw: '7' },
    discount: { raw: '0.15' },
    region: { raw: 'Midwest', transformed: 'MIDWEST' },
  },
  {
    orderId: { raw: '10004' },
    custId: { raw: '4401' },
    dateKey: { raw: '20240117' },
    amount: { raw: '275.00' },
    quantity: { raw: '2' },
    discount: { raw: '0.05' },
    region: { raw: 'South', transformed: 'SOUTH' },
  },
  {
    orderId: { raw: '10005' },
    custId: { raw: '2891' },
    dateKey: { raw: '20240118' },
    amount: { raw: '8120.00' },
    quantity: { raw: '12' },
    discount: { raw: '0.20' },
    region: { raw: 'West', transformed: 'WEST' },
  },
];
