import type { ColumnGroup, DerivedSource, MappingState } from '@/features/sttm/types/sttm.types';

export type SourceColumnOption = {
  label: string;
  value: string;
  dataType: string;
  group: string;
};

export function tableAlias(tableName: string) {
  return tableName.toLowerCase();
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
  const isDefault = !normalizedRule || normalizedRule === 'Select...' || normalizedRule === 'Direct';

  if (normalizedRule === 'Custom' && expression?.trim()) {
    return sourceColumns.length
      ? `Custom expression maps ${targetColumn} using ${joinedSources}.`
      : `Custom expression mapping for ${targetColumn}.`;
  }

  if (sourceColumns.length === 0) {
    return '';
  }

  if (isDefault) {
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

export function buildMappingExpression(mapping: MappingState) {
  const sourceColumns =
    mapping.sourceColumns && mapping.sourceColumns.length
      ? mapping.sourceColumns
      : parseSourceColumns(mapping.sourceColumn);

  if (mapping.expression?.trim()) {
    return mapping.expression.trim();
  }
  if (!sourceColumns.length) {
    return 'NULL';
  }

  const rule = (mapping.rule || 'Direct').trim().toUpperCase();
  if (rule === 'DIRECT' || rule === 'SELECT...') {
    return sourceColumns[0];
  }
  if (rule === 'CONCATENATE') {
    return `CONCAT(${sourceColumns.join(', ')})`;
  }
  if (sourceColumns.length === 1 && ['UPPER', 'LOWER', 'TRIM'].includes(rule)) {
    return `${rule}(${sourceColumns[0]})`;
  }
  if (sourceColumns.length === 1 && rule === 'NULLIF') {
    return `NULLIF(${sourceColumns[0]}, '')`;
  }
  return sourceColumns[0];
}

export function buildMappingSelectSql(params: {
  mappings: MappingState[];
  sourceQuerySql: string;
  sourceFilterSql?: string;
  sourceGroupBySql?: string;
  sourceOrderBySql?: string;
}) {
  const { mappings, sourceQuerySql, sourceFilterSql, sourceGroupBySql, sourceOrderBySql } = params;
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
      .map((mapping) => `  ${buildMappingExpression(mapping)} AS ${mapping.targetColumn}`)
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
  sourceFilterSql?: string;
  sourceGroupBySql?: string;
  sourceOrderBySql?: string;
}) {
  const {
    mappings,
    targetQualifiedName,
    sourceQuerySql,
    sourceFilterSql,
    sourceGroupBySql,
    sourceOrderBySql,
  } = params;
  const selectSql = buildMappingSelectSql({
    mappings,
    sourceQuerySql,
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
