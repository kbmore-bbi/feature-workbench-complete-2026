import type { SqlFunctionCategory, SqlFunctionCategoryId, SqlSnippetAction } from './types';

export const SQL_FUNCTION_CATEGORIES: SqlFunctionCategory[] = [
  { id: 'string', label: 'String' },
  { id: 'numeric', label: 'Numeric' },
  { id: 'date', label: 'Date' },
  { id: 'conversion', label: 'Conversion' },
  { id: 'logic', label: 'Logic' },
  { id: 'window', label: 'Window +' },
];

export const SQL_QUICK_ACTIONS: SqlSnippetAction[] = [
  { id: 'cast', label: 'CAST()', snippet: 'CAST()', wrapExisting: true },
  { id: 'coalesce', label: 'COALESCE()', snippet: 'COALESCE()', wrapExisting: true },
  { id: 'concat', label: 'CONCAT()', snippet: 'CONCAT()', wrapExisting: true },
  { id: 'case', label: 'CASE WHEN ...', snippet: 'CASE WHEN ...' },
  { id: 'count', label: 'COUNT(*)', snippet: 'COUNT(*)' },
  { id: 'sum', label: 'SUM()', snippet: 'SUM()', wrapExisting: true },
  { id: 'avg', label: 'AVG()', snippet: 'AVG()', wrapExisting: true },
];

/** Full SELECT-list snippets commonly used in the derived-table SQL editor. */
export const SQL_DERIVED_QUICK_ACTIONS: SqlSnippetAction[] = [
  { id: 'count', label: 'COUNT', snippet: 'COUNT(*) AS total_count' },
  { id: 'sum', label: 'SUM', snippet: 'SUM(amount) AS total_amount' },
  { id: 'avg', label: 'AVG', snippet: 'AVG(amount) AS avg_amount' },
  { id: 'concat', label: 'CONCAT', snippet: "CONCAT(first_name, ' ', last_name) AS full_name" },
  {
    id: 'case',
    label: 'CASE',
    snippet: "CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END AS is_active",
  },
  {
    id: 'row-number',
    label: 'ROW_NUMBER',
    snippet:
      'ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_datetime DESC) AS row_num',
  },
  {
    id: 'lag',
    label: 'LAG',
    snippet:
      'LAG(amount) OVER (PARTITION BY customer_id ORDER BY created_datetime) AS previous_amount',
  },
  {
    id: 'lead',
    label: 'LEAD',
    snippet:
      'LEAD(amount) OVER (PARTITION BY customer_id ORDER BY created_datetime) AS next_amount',
  },
];

export const SQL_FUNCTIONS_BY_CATEGORY: Record<SqlFunctionCategoryId, string[]> = {
  string: [
    'CONCAT()',
    "CONCAT(first_name, ' ', last_name) AS full_name",
    'UPPER()', 'LOWER()', 'TRIM()', 'LTRIM()',
    'RTRIM()', 'SUBSTRING()', 'REPLACE()',
    'LENGTH()', 'REGEXP_REPLACE()',
    'LPAD()', 'RPAD()', 'INITCAP()',
  ],
  numeric: [
    'COUNT(*)', 'COUNT(*) AS total_count',
    'SUM()', 'SUM(amount) AS total_amount',
    'AVG()', 'AVG(amount) AS avg_amount',
    'MIN()', 'MAX()',
    'ROUND()', 'FLOOR()', 'CEIL()', 'ABS()',
    'MOD()', 'POWER()', 'SQRT()', 'SIGN()',
    'TRUNC()',
  ],
  date: [
    'CURRENT_DATE()', 'CURRENT_TIMESTAMP()', 'DATEADD()',
    'DATEDIFF()', 'DATE_TRUNC()', 'EXTRACT()',
    'TO_DATE()', 'TO_TIMESTAMP()',
    'DATE_FORMAT()', 'NOW()', 'DATE_ADD()', 'DATE_SUB()',
    'YEAR()', 'MONTH()', 'DAY()', 'CURRENT_DATE',
  ],
  conversion: [
    'CAST()', 'TRY_CAST()', 'TO_VARCHAR()', 'TO_NUMBER()',
    'TO_BOOLEAN()', 'COALESCE()', 'NULLIF()', 'IFF()', 'DECODE()',
    'CONVERT()', 'ISNULL()', 'TO_CHAR()', 'NVL()',
  ],
  logic: [
    'CASE WHEN ...',
    "CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END AS is_active",
    'IFF()', 'IIF()', 'DECODE()',
    'COALESCE()', 'NULLIF()', 'NVL()',
    'AND', 'OR', 'NOT',
    'GREATEST()', 'LEAST()',
  ],
  window: [
    'ROW_NUMBER() OVER()',
    'ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_datetime DESC) AS row_num',
    'LAG() OVER()',
    'LAG(amount) OVER (PARTITION BY customer_id ORDER BY created_datetime) AS previous_amount',
    'LEAD() OVER()',
    'LEAD(amount) OVER (PARTITION BY customer_id ORDER BY created_datetime) AS next_amount',
    'RANK() OVER()', 'DENSE_RANK() OVER()',
    'SUM() OVER()', 'COUNT() OVER()', 'AVG() OVER()',
    'MIN() OVER()', 'MAX() OVER()',
    'NTILE() OVER()', 'FIRST_VALUE() OVER()', 'LAST_VALUE() OVER()',
    'PERCENT_RANK() OVER()', 'CUME_DIST() OVER()',
  ],
};
