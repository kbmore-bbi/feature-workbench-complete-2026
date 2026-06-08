import type { ColumnGroup, DerivedSource, MappingState } from '@/features/sttm/types/sttm.types';
import type { RelationshipContextItem, TableRef } from '@/types/api-contract';

export type SourceColumnOption = {
  label: string;
  value: string;
  dataType: string;
  group: string;
};

export function tableAlias(tableName: string) {
  return tableName.toLowerCase();
}

function qualifiedTableName(table: TableRef) {
  return `${table.database}.${table.schema}.${table.table}`.replace(/\.+/g, '.');
}

function qualifiedColumnName(table: TableRef, columnName: string) {
  return `${qualifiedTableName(table)}.${columnName}`.replace(/\.+/g, '.');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatSqlType(type?: string) {
  if (!type) return 'VARCHAR';
  const upper = type.toUpperCase();
  if (upper.includes('NUMBER') || upper === 'INT') return 'BIGINT';
  if (upper.includes('VARCHAR') || upper.includes('TEXT')) return 'VARCHAR';
  if (upper.includes('DATE') && !upper.includes('TIME')) return 'DATE';
  if (upper.includes('TIMESTAMP')) return 'TIMESTAMP';
  if (upper.includes('DECIMAL') || upper.includes('FLOAT')) return 'DECIMAL';
  return upper;
}

const COLUMN_SAMPLE_VALUES: Record<string, string> = {
  CUSTOMER_ID: '2047',
  CUSTOMER_KEY: '2047',
  CUSTOMER_NAME: 'Acme Corp',
  EMAIL: 'acme@corp.com',
  COUNTRY_CODE: 'US',
  ORDER_ID: '10001',
  ORDER_DATE: '20230115',
  ORDER_DATE_KEY: '20230115',
  ORDER_AMOUNT: '1240.50',
  NET_AMOUNT: '1240.50',
  QUANTITY: '3',
  COMMISSION_RATE: '0.10',
  STATUS: 'shipped',
  REGION_NAME: 'Northeast',
  CREATED_DATE: '20230115',
  ORDER_ITEM_ID: '90001',
  PRODUCT_ID: '301',
  LINE_AMOUNT: '49.98',
  SALES_KEY: '88001',
  PRODUCT_KEY: '401',
  SALE_DATE: '2024-02-01',
  SEGMENT: 'enterprise',
  COUNTRY: 'United States',
};

export function getColumnSampleDisplayValue(columnName?: string, dataType?: string): string {
  const name = String(columnName || '').trim().toUpperCase();
  if (name && COLUMN_SAMPLE_VALUES[name]) {
    return COLUMN_SAMPLE_VALUES[name];
  }

  const formatted = formatSqlType(dataType).toLowerCase();
  if (formatted.includes('date') || formatted.includes('timestamp')) {
    return '2024-01-01';
  }
  if (
    formatted.includes('int') ||
    formatted.includes('number') ||
    formatted.includes('decimal') ||
    formatted.includes('float')
  ) {
    return '0';
  }
  if (name.endsWith('_ID')) {
    return '1001';
  }
  if (name.includes('EMAIL')) {
    return 'user@example.com';
  }
  if (name.includes('NAME')) {
    return 'Sample';
  }
  if (name.includes('STATUS')) {
    return 'active';
  }
  return '—';
}

export type MappingDataPreviewResult = {
  sourceValue: string | null;
  transformedValue: string | null;
  displayValue: string | null;
  ruleLabel: string | null;
  hasTransform: boolean;
};

function applyPreviewTransform(
  value: string,
  rule: string,
  expression?: string | null,
): string {
  const normalizedRule = rule.trim().toUpperCase();

  switch (normalizedRule) {
    case 'UPPER':
      return value.toUpperCase();
    case 'LOWER':
      return value.toLowerCase();
    case 'TRIM':
      return value.trim();
    case 'DATE_FORMAT': {
      const digits = value.replace(/\D/g, '');
      if (digits.length === 8) {
        return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
      }
      return value;
    }
    case 'CAST':
      return value;
    case 'COALESCE':
      return value || '—';
    case 'SUBSTRING':
      return value.slice(0, Math.min(4, value.length));
    case 'REPLACE':
      return value;
    case 'NULLIF':
      return value === '' ? 'NULL' : value;
    case 'CONCATENATE':
      return value;
    case 'CUSTOM':
      return expression?.trim() ? value : value;
    default:
      return value;
  }
}

export function getMappingSourceColumnLabel(mapping: MappingState): string | null {
  const sourceColumns =
    mapping.sourceColumns && mapping.sourceColumns.length
      ? mapping.sourceColumns
      : parseSourceColumns(mapping.sourceColumn);
  return sourceColumns[0] ?? null;
}

function toSafePreviewText(value: unknown, maxLength = 160): string | null {
  if (value == null) {
    return null;
  }

  let text: string | null = null;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    text = String(value);
  }

  if (!text) {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

export function buildMappingDataPreview(mapping: MappingState): MappingDataPreviewResult {
  const sourceColumn = getMappingSourceColumnLabel(mapping);
  if (!sourceColumn) {
    return {
      sourceValue: null,
      transformedValue: null,
      displayValue: null,
      ruleLabel: null,
      hasTransform: false,
    };
  }

  const columnName = sourceColumn.split('.').pop() ?? sourceColumn;
  const sourceValue = toSafePreviewText(
    getColumnSampleDisplayValue(
      columnName,
      mapping.sourceType ?? mapping.targetType ?? undefined,
    ),
  );

  const rule = toSafePreviewText(mapping.rule, 64) ?? 'Direct';
  const isDirect = rule === 'Direct' || rule === 'Select...';

  if (isDirect) {
    return {
      sourceValue,
      transformedValue: null,
      displayValue: sourceValue,
      ruleLabel: null,
      hasTransform: false,
    };
  }

  const transformedValue = toSafePreviewText(
    applyPreviewTransform(sourceValue ?? '', rule, mapping.expression),
  );

  return {
    sourceValue,
    transformedValue,
    displayValue: transformedValue,
    ruleLabel: rule.toUpperCase(),
    hasTransform: true,
  };
}

export function typeChipSx(dataType?: string) {
  const formatted = formatSqlType(dataType);
  const isNumeric =
    formatted === 'BIGINT' ||
    formatted === 'INT' ||
    formatted === 'DECIMAL' ||
    formatted === 'NUMBER';
  return {
    height: 20,
    fontSize: '0.65rem',
    borderRadius: '4px',
    fontWeight: 700,
    bgcolor: isNumeric ? '#1f2937' : '#f3f4f6',
    color: isNumeric ? '#fff' : '#4b5563',
    border: isNumeric ? 'none' : '1px solid #e5e7eb',
  } as const;
}

export function getDerivedDisplayColumns(source: DerivedSource): Array<{ name: string; type: string }> {
  if (source.previewColumns?.length) {
    return source.previewColumns.map((column) => ({
      name: column.name,
      type: column.dataType || '—',
    }));
  }
  return (source.columns ?? [])
    .filter((column) => column.name)
    .map((column) => ({
      name: String(column.name),
      type: column.type ?? '—',
    }));
}

export function buildSourceColumnOptions(
  sourceAttributeGroups: ColumnGroup[],
  derivedSources: DerivedSource[],
): SourceColumnOption[] {
  const options: SourceColumnOption[] = [];

  for (const group of sourceAttributeGroups) {
    for (const column of group.columns) {
      if (!column.name) continue;
      options.push({
        label: `${group.table}.${column.name}`,
        value: `${group.qualifiedName}.${column.name}`,
        dataType: column.type || 'VARCHAR',
        group: group.table,
      });
    }
  }

  for (const source of derivedSources.filter((item) => item.isSelected)) {
    const alias = tableAlias(source.sourceName.replace(/\s+/g, '_'));
    for (const column of getDerivedDisplayColumns(source)) {
      options.push({
        label: `${alias}.${column.name}`,
        value: `${alias}.${column.name}`,
        dataType: column.type,
        group: source.sourceName,
      });
    }
  }

  return options;
}

export function findSourceColumnOption(
  options: SourceColumnOption[],
  value: string | null | undefined,
) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return (
    options.find((option) => option.value.toLowerCase() === normalized) ??
    options.find((option) => option.label.toLowerCase() === normalized) ??
    null
  );
}

export function generateMappingDescription(params: {
  rule: string;
  sourceColumns: string[];
  targetColumn: string;
  expression?: string | null;
}): string {
  const { rule, sourceColumns, targetColumn, expression } = params;
  const joinedSources = sourceColumns.join(', ');
  const normalizedRule = (rule || '').trim();

  if (!normalizedRule || normalizedRule === 'Select...') {
    return '';
  }

  if (normalizedRule === 'Custom' && expression?.trim()) {
    return sourceColumns.length
      ? `Custom expression maps ${targetColumn} using ${joinedSources}.`
      : `Custom expression mapping for ${targetColumn}.`;
  }

  if (sourceColumns.length === 0) {
    return '';
  }

  if (normalizedRule === 'Direct') {
    return sourceColumns.length === 1
      ? `Direct mapping from ${sourceColumns[0]} to ${targetColumn}.`
      : `Maps ${targetColumn} from ${joinedSources}.`;
  }

  return `Applies ${normalizedRule} on ${joinedSources} for ${targetColumn}.`;
}

export function parseSourceColumns(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeBaseQuerySql(baseSql: string) {
  const trimmed = baseSql.trim().replace(/;+\s*$/, '');
  if (!trimmed) return '';
  return trimmed.replace(/^SELECT\s+\*\s+/i, '');
}

function buildSourceAliasLookup(params: {
  sourceTables: TableRef[];
  derivedSources?: DerivedSource[];
}) {
  const { sourceTables, derivedSources = [] } = params;
  const lookup = new Map<string, string>();

  for (const table of sourceTables) {
    lookup.set(tableAlias(table.table), qualifiedTableName(table));
  }

  for (const source of derivedSources.filter((item) => item.isSelected !== false)) {
    const aliasSeed = source.alias || source.sourceName || source.id;
    lookup.set(tableAlias(String(aliasSeed).replace(/\s+/g, '_')), String(aliasSeed));
  }

  return lookup;
}

function normalizeSourceExpression(
  expression: string,
  params: {
    sourceTables: TableRef[];
    derivedSources?: DerivedSource[];
  },
) {
  let normalized = expression;
  const aliasLookup = buildSourceAliasLookup(params);

  for (const [alias, qualified] of aliasLookup.entries()) {
    if (!qualified || qualified === alias) {
      continue;
    }
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9_\\.])(${escapeRegExp(alias)})\\.([A-Za-z_][A-Za-z0-9_$]*)`,
      'gi',
    );
    normalized = normalized.replace(pattern, (_, prefix: string, _alias: string, column: string) =>
      `${prefix}${qualified}.${column}`,
    );
  }

  return normalized;
}

export function buildFallbackSourceQuerySql(params: {
  sourceQuerySql?: string | null;
  sourceTables: TableRef[];
  derivedSources?: DerivedSource[];
  relationships?: RelationshipContextItem[];
  drivingTable?: TableRef | null;
}) {
  const {
    sourceQuerySql,
    sourceTables,
    derivedSources = [],
    relationships = [],
    drivingTable,
  } = params;

  if (sourceQuerySql?.trim()) {
    return sourceQuerySql;
  }

  const selectedDerivedSources = derivedSources.filter((source) => source.isSelected !== false);
  if (!sourceTables.length && selectedDerivedSources.length === 1) {
    const derivedSql = selectedDerivedSources[0].sqlText?.trim().replace(/;+\s*$/, '');
    if (derivedSql) {
      const aliasSeed =
        selectedDerivedSources[0].alias ||
        selectedDerivedSources[0].sourceName ||
        selectedDerivedSources[0].id;
      const alias = tableAlias(String(aliasSeed).replace(/\s+/g, '_'));
      return `FROM (\n${derivedSql}\n) ${alias}`;
    }
  }

  if (!sourceTables.length) {
    return '';
  }

  const tableByQualifiedName = new Map(
    sourceTables.map((table) => [qualifiedTableName(table).toUpperCase(), table] as const),
  );
  const seedTable =
    (drivingTable ? tableByQualifiedName.get(qualifiedTableName(drivingTable).toUpperCase()) : null) ??
    sourceTables[0];
  if (!seedTable) {
    return '';
  }

  const lines = [`FROM ${qualifiedTableName(seedTable)}`];
  const visited = new Set<string>([qualifiedTableName(seedTable).toUpperCase()]);
  const pending = relationships.filter(
    (relationship) =>
      relationship.left_table &&
      relationship.right_table &&
      Array.isArray(relationship.conditions) &&
      relationship.conditions.some((condition) => condition.left_column && condition.right_column),
  );

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const relationship of pending) {
      const leftName = qualifiedTableName(relationship.left_table).toUpperCase();
      const rightName = qualifiedTableName(relationship.right_table).toUpperCase();
      const leftVisited = visited.has(leftName);
      const rightVisited = visited.has(rightName);

      if (leftVisited === rightVisited) {
        continue;
      }

      const attachingTable = leftVisited ? relationship.right_table : relationship.left_table;
      const attachingName = qualifiedTableName(attachingTable).toUpperCase();
      const joinType = relationship.join_type?.trim() || 'INNER';
      const validConditions = (relationship.conditions ?? []).filter(
        (condition) => condition.left_column && condition.right_column,
      );
      if (!validConditions.length) {
        continue;
      }

      lines.push(`${joinType} JOIN ${qualifiedTableName(attachingTable)}`);
      lines.push(
        `  ON ${validConditions
          .map(
            (condition) =>
              `${qualifiedColumnName(relationship.left_table, condition.left_column)} ${condition.operator ?? '='} ${qualifiedColumnName(relationship.right_table, condition.right_column)}`,
          )
          .join('\n  AND ')}`,
      );
      visited.add(attachingName);
      progressed = true;
    }
  }

  const unjoinedTables = sourceTables.filter(
    (table) => !visited.has(qualifiedTableName(table).toUpperCase()),
  );
  if (unjoinedTables.length) {
    lines.push('-- Additional selected tables are waiting for join conditions:');
    lines.push(
      ...unjoinedTables.map((table) => `-- ${qualifiedTableName(table)}`),
    );
  }

  return lines.join('\n');
}

export function buildSourceQueryPreviewSql(params: {
  sourceQuerySql: string;
  sourceFilterSql?: string;
  sourceGroupBySql?: string;
  sourceOrderBySql?: string;
}) {
  const { sourceQuerySql, sourceFilterSql, sourceGroupBySql, sourceOrderBySql } = params;
  const fromClause = normalizeBaseQuerySql(sourceQuerySql);
  if (!fromClause) {
    return '-- Select source tables and relationships in Step 1 to generate SQL.';
  }

  const lines = ['SELECT', '  *', fromClause];

  if (sourceFilterSql?.trim()) {
    lines.push(`WHERE\n${sourceFilterSql.trim()}`);
  }
  if (sourceGroupBySql?.trim()) {
    lines.push(`GROUP BY\n  ${sourceGroupBySql.trim()}`);
  }
  if (sourceOrderBySql?.trim()) {
    lines.push(`ORDER BY\n  ${sourceOrderBySql.trim()}`);
  }

  return lines.join('\n');
}

export function buildMappingExpression(mapping: MappingState) {
  return buildResolvedMappingExpression(mapping, { sourceTables: [], derivedSources: [] });
}

export function buildResolvedMappingExpression(
  mapping: MappingState,
  params: {
    sourceTables: TableRef[];
    derivedSources?: DerivedSource[];
  },
) {
  const sourceColumns =
    mapping.sourceColumns && mapping.sourceColumns.length
      ? mapping.sourceColumns
      : parseSourceColumns(mapping.sourceColumn);

  if (mapping.expression?.trim()) {
    return normalizeSourceExpression(mapping.expression.trim(), params);
  }
  if (!sourceColumns.length) {
    return 'NULL';
  }

  const normalizedSourceColumns = sourceColumns.map((item) =>
    normalizeSourceExpression(item, params),
  );

  const rule = (mapping.rule || 'Direct').trim().toUpperCase();
  if (rule === 'DIRECT' || rule === 'SELECT...') {
    return normalizedSourceColumns[0];
  }
  if (rule === 'CONCATENATE') {
    return `CONCAT(${normalizedSourceColumns.join(', ')})`;
  }
  if (sourceColumns.length === 1 && ['UPPER', 'LOWER', 'TRIM'].includes(rule)) {
    return `${rule}(${normalizedSourceColumns[0]})`;
  }
  if (sourceColumns.length === 1 && rule === 'NULLIF') {
    return `NULLIF(${normalizedSourceColumns[0]}, '')`;
  }
  return normalizedSourceColumns[0];
}

export function buildMappingSelectSql(params: {
  mappings: MappingState[];
  sourceQuerySql: string;
  sourceTables?: TableRef[];
  derivedSources?: DerivedSource[];
  sourceFilterSql?: string;
  sourceGroupBySql?: string;
  sourceOrderBySql?: string;
}) {
  const {
    mappings,
    sourceQuerySql,
    sourceTables = [],
    derivedSources = [],
    sourceFilterSql,
    sourceGroupBySql,
    sourceOrderBySql,
  } = params;
  const activeMappings = mappings.filter((mapping) => mapping.status === 'MAPPED');
  if (!activeMappings.length) {
    return '-- No columns mapped yet. Map columns to generate SQL.';
  }

  const fromClause = normalizeBaseQuerySql(sourceQuerySql);
  if (!fromClause) {
    return '-- Select source tables and relationships in Step 1 to generate SQL.';
  }

  const lines = [
    'SELECT',
    activeMappings
      .map(
        (mapping) =>
          `  ${buildResolvedMappingExpression(mapping, { sourceTables, derivedSources })} AS ${mapping.targetColumn}`,
      )
      .join(',\n'),
    fromClause,
  ];

  if (sourceFilterSql?.trim()) {
    lines.push(`WHERE\n${sourceFilterSql.trim()}`);
  }
  if (sourceGroupBySql?.trim()) {
    lines.push(`GROUP BY\n  ${sourceGroupBySql.trim()}`);
  }
  if (sourceOrderBySql?.trim()) {
    lines.push(`ORDER BY\n  ${sourceOrderBySql.trim()}`);
  }

  return lines.join('\n');
}

export function buildMappingInsertSql(params: {
  mappings: MappingState[];
  targetQualifiedName: string | null;
  sourceQuerySql: string;
  sourceTables?: TableRef[];
  derivedSources?: DerivedSource[];
  sourceFilterSql?: string;
  sourceGroupBySql?: string;
  sourceOrderBySql?: string;
}) {
  const {
    mappings,
    targetQualifiedName,
    sourceQuerySql,
    sourceTables = [],
    derivedSources = [],
    sourceFilterSql,
    sourceGroupBySql,
    sourceOrderBySql,
  } = params;
  const selectSql = buildMappingSelectSql({
    mappings,
    sourceQuerySql,
    sourceTables,
    derivedSources,
    sourceFilterSql,
    sourceGroupBySql,
    sourceOrderBySql,
  });
  if (selectSql.startsWith('--')) {
    return selectSql;
  }

  const activeMappings = mappings.filter((mapping) => mapping.status === 'MAPPED');
  const insertColumns = activeMappings.map((mapping) => `  ${mapping.targetColumn}`).join(',\n');
  const today = new Date().toISOString().slice(0, 10);

  return [
    '-- STTM Builder - Auto-generated SQL',
    `-- Target: ${targetQualifiedName ?? 'TARGET_TABLE'}`,
    `-- Date: ${today}`,
    '',
    `INSERT INTO ${targetQualifiedName ?? 'TARGET_TABLE'} (`,
    insertColumns,
    ')',
    selectSql,
    ';',
  ].join('\n');
}
