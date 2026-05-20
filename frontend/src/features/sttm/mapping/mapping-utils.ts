import type { ColumnGroup, DerivedSource } from '@/features/sttm/types/sttm.types';

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
    const alias = tableAlias(group.table);
    for (const column of group.columns) {
      if (!column.name) continue;
      options.push({
        label: `${alias}.${column.name}`,
        value: `${alias}.${column.name}`,
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
