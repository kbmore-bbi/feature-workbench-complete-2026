import type { ColumnGroup, DerivedSource, MappingMode, MappingState } from '@/features/sttm/types/sttm.types';
import type { RelationGraphContext, RelationshipContextItem, TableRef } from '@/types/api-contract';
import type { JoinConfig } from '@/features/sttm/types/sttm.types';

export type SourceColumnOption = {
  label: string;
  value: string;
  dataType: string;
  group: string;
};

export function tableAlias(tableName: string) {
  return tableName.toLowerCase();
}

function compilerRelationAlias(seed: string, index: number) {
  const suffix = seed.split('.').pop()?.replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
  return `${suffix || 'source'}_${index + 1}`;
}

export function buildCompilerRelationGraph(params: {
  sourceTables: TableRef[];
  sourceColumnsByTable?: Record<string, Array<{ name?: string | null; type?: string | null }>>;
  derivedSources: DerivedSource[];
  relationships: JoinConfig[];
  mappings: MappingState[];
}): RelationGraphContext {
  const { sourceTables, sourceColumnsByTable = {}, derivedSources, relationships, mappings } = params;
  const selectedDerived = derivedSources.filter((source) => source.isSelected);
  const nodes: RelationGraphContext['nodes'] = [
    ...sourceTables.map((table, index) => {
      const relationId = qualifiedTableName(table);
      return {
        relation_id: relationId,
        kind: 'PHYSICAL_TABLE' as const,
        alias: compilerRelationAlias(relationId, index),
        table,
        output_columns: (sourceColumnsByTable[relationId] ?? []).map((column) => ({
          name: column.name,
          data_type: column.type,
        })),
      };
    }),
    ...selectedDerived.map((source, index) => ({
      relation_id: source.id,
      kind: 'DERIVED_SOURCE' as const,
      alias: source.alias || compilerRelationAlias(source.sourceName || source.id, sourceTables.length + index),
      derived_source_id: source.id,
      physical_view_name: source.physicalViewName ?? null,
      sql_text: source.sqlText ?? null,
      output_columns: source.outputColumns ?? source.previewColumns?.map((column) => ({
        name: column.name,
        data_type: column.dataType,
        is_primary_key: column.isPrimaryKey,
      })) ?? [],
      column_semantics: source.columnSemantics ?? [],
      grain: source.grain ?? null,
      keys: source.keys ?? [],
      dependency_hash: source.sourceDependencyHash ?? source.upstreamHash ?? null,
      parent_relation_ids: source.parentDerivedSourceIds ?? source.derivedSourceIds ?? [],
      base_relation_ids: (source.baseSourceTables ?? []).map(qualifiedTableName),
    })),
  ];
  const nodeIds = new Set(nodes.map((node) => node.relation_id));
  const edges = relationships
    .filter((join) => join.leftTableId && join.rightTableId && nodeIds.has(join.leftTableId) && nodeIds.has(join.rightTableId))
    .map((join, index) => ({
      edge_id: join.id ?? `relation-edge-${index + 1}`,
      left_relation_id: String(join.leftTableId),
      right_relation_id: String(join.rightTableId),
      join_type: join.joinType ?? 'INNER',
      provenance: join.source ?? 'USER_DEFINED',
      validation_status: join.locked ? 'validated' : 'selected',
      conditions: (join.conditions ?? [])
        .filter((condition) => condition.leftColumn && condition.rightColumn)
        .map((condition) => ({
          left_column: String(condition.leftColumn),
          right_column: String(condition.rightColumn),
          operator: condition.operator ?? '=',
        })),
    }))
    .filter((edge) => edge.conditions.length > 0);
  const value_bindings = mappings
    .filter(
      (mapping) =>
        (mapping.mappingMode === 'constant' || mapping.mappingMode === 'attribute')
        && mapping.constantValue != null,
    )
    .map((mapping) => {
      const placeholder = String(mapping.constantValue).trim().startsWith('$');
      return {
        binding_id: mapping.valueBindingIds?.[0] ?? mapping.id,
        value: String(mapping.constantValue),
        data_type: mapping.targetType || null,
        is_placeholder: placeholder,
        allow_project_specific_value: false,
        resolution_status: placeholder ? 'placeholder_contract' : 'resolved',
      };
    });
  return { nodes, edges, value_bindings };
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

export function parseMappingMode(value: unknown): MappingMode {
  const mode = String(value ?? "source").toLowerCase();
  if (mode === "constant") return "constant";
  if (mode === "attribute") return "attribute";
  return "source";
}

export function getMappingSourceColumnLabel(mapping: MappingState): string | null {
  if (mapping.mappingMode === "constant") {
    return mapping.constantValue?.trim() || null;
  }
  if (mapping.mappingMode === "attribute") {
    return mapping.attributeName?.trim() || null;
  }
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
  if (mapping.mappingMode === "constant" || mapping.mappingMode === "attribute") {
    const constantValue = toSafePreviewText(mapping.constantValue);
    return {
      sourceValue: constantValue,
      transformedValue: constantValue,
      displayValue: constantValue,
      ruleLabel: mapping.mappingMode === "attribute" ? "ATTRIBUTE" : "VALUE",
      hasTransform: true,
    };
  }
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

export function typeChipColor(dataType?: string): 'default' | 'primary' | 'secondary' | 'info' {
  const formatted = formatSqlType(dataType);
  const isNumeric =
    formatted === 'BIGINT' ||
    formatted === 'INT' ||
    formatted === 'DECIMAL' ||
    formatted === 'NUMBER';
  const isDate = formatted === 'DATE' || formatted === 'TIMESTAMP';

  if (isNumeric) return 'secondary';
  if (isDate) return 'info';
  return 'default';
}

export function getDerivedDisplayColumns(source: DerivedSource): Array<{ name: string; type: string }> {
  if (source.previewColumns?.length) {
    return source.previewColumns.map((column) => ({
      name: column.name,
      type: column.dataType || '—',
    }));
  }
  if (source.outputColumns?.length) {
    return source.outputColumns
      .map((column) => ({
        name: String(column.name ?? column.column_name ?? '').trim(),
        type: String(column.data_type ?? column.dataType ?? column.type ?? '—'),
      }))
      .filter((column) => Boolean(column.name));
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

function qualifyBareSourceIdentifiers(expression: string, sourceColumns: string[]) {
  const candidates = new Map<string, Set<string>>();
  for (const sourceColumn of sourceColumns) {
    const normalized = String(sourceColumn || '').trim();
    if (!normalized) continue;
    const columnName = normalized.split('.').pop()?.trim();
    if (!columnName) continue;
    const key = columnName.toUpperCase();
    const values = candidates.get(key) ?? new Set<string>();
    values.add(normalized);
    candidates.set(key, values);
  }

  let output = '';
  let index = 0;
  let quote: "'" | '"' | '`' | null = null;
  while (index < expression.length) {
    const character = expression[index];
    if (quote) {
      output += character;
      if (character === quote) {
        if (quote === "'" && expression[index + 1] === "'") {
          output += expression[index + 1];
          index += 2;
          continue;
        }
        quote = null;
      }
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      let end = index + 1;
      while (end < expression.length && /[A-Za-z0-9_$]/.test(expression[end])) {
        end += 1;
      }
      const token = expression.slice(index, end);
      const prior = index > 0 ? expression[index - 1] : '';
      const next = end < expression.length ? expression[end] : '';
      const matches = candidates.get(token.toUpperCase());
      output += prior !== '.' && next !== '.' && matches?.size === 1
        ? [...matches][0]
        : token;
      index = end;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
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
  if (mapping.mappingMode === "constant" || mapping.mappingMode === "attribute") {
    return buildSnowflakeConstantExpression(mapping.constantValue, mapping.targetType);
  }
  const sourceColumns =
    mapping.sourceColumns && mapping.sourceColumns.length
      ? mapping.sourceColumns
      : parseSourceColumns(mapping.sourceColumn);

  if (mapping.expression?.trim()) {
    const normalizedHints = sourceColumns.map((item) =>
      normalizeSourceExpression(item, params),
    );
    return qualifyBareSourceIdentifiers(
      normalizeSourceExpression(mapping.expression.trim(), params),
      normalizedHints,
    );
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

function buildSnowflakeConstantExpression(
  value: string | null | undefined,
  targetType: string | null | undefined,
) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.toUpperCase() === "NULL") {
    return "NULL";
  }

  const normalizedType = String(targetType ?? "").trim().toUpperCase();
  if (
    /^(NUMBER|DECIMAL|NUMERIC|INT|INTEGER|BIGINT|SMALLINT|FLOAT|DOUBLE|REAL)/.test(
      normalizedType,
    )
    && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)
  ) {
    return trimmed;
  }
  if (
    /^(BOOLEAN|BOOL)/.test(normalizedType)
    && /^(TRUE|FALSE)$/i.test(trimmed)
  ) {
    return trimmed.toUpperCase();
  }

  const quoted = `'${trimmed.replaceAll("'", "''")}'`;
  if (/^(DATE|TIME|TIMESTAMP)/.test(normalizedType)) {
    return `CAST(${quoted} AS ${normalizedType})`;
  }
  if (/^(VARIANT|OBJECT|ARRAY)/.test(normalizedType)) {
    return `PARSE_JSON(${quoted})`;
  }
  return quoted;
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
