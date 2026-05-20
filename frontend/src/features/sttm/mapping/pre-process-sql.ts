import type {
  ColumnGroup,
  DerivedSource,
  JoinConfig,
  TableNode,
} from '@/features/sttm/types/sttm.types';
import { tableAlias } from './mapping-utils';

type BuildPreProcessSqlParams = {
  expression: string;
  targetColumn: string;
  sourceAttributeGroups: ColumnGroup[];
  relationships: JoinConfig[];
  sources: TableNode[];
  drivingTableId: string | null;
  derivedSources?: DerivedSource[];
};

function aliasForTable(table: TableNode, index: number) {
  const fromName = table.tableName || table.qualifiedName.split('.').pop() || 't';
  return tableAlias(fromName) || `t${index + 1}`;
}

function renderFromTable(table: TableNode, alias: string, derivedSources: DerivedSource[]) {
  const derived = derivedSources.find((item) => item.id === table.tableId);
  if (derived?.sqlText?.trim()) {
    const indented = derived.sqlText
      .trim()
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
    return `(\n${indented}\n) ${alias}`;
  }
  return `${table.qualifiedName} ${alias}`;
}

export function buildPreProcessSql({
  expression,
  targetColumn,
  sourceAttributeGroups,
  relationships,
  sources,
  drivingTableId,
  derivedSources = [],
}: BuildPreProcessSqlParams): string {
  const expr = expression.trim();
  if (!expr || !targetColumn.trim()) {
    return '';
  }

  const selectedSources = sources.filter((source) => source.isSelected);
  const aliasByTableId = Object.fromEntries(
    selectedSources.map((table, index) => [table.tableId, aliasForTable(table, index)]),
  ) as Record<string, string>;

  const lines = ['SELECT', `  ${expr} AS ${targetColumn}`];

  const driving =
    selectedSources.find((table) => table.tableId === drivingTableId) ??
    selectedSources[0] ??
    null;

  if (driving) {
    const drivingAlias = aliasByTableId[driving.tableId] ?? 'a';
    lines.push(`FROM ${renderFromTable(driving, drivingAlias, derivedSources)}`);
  } else if (sourceAttributeGroups[0]) {
    const group = sourceAttributeGroups[0];
    const alias = tableAlias(group.table);
    lines.push(`FROM ${group.qualifiedName} ${alias}`);
  } else {
    lines.push('FROM ...');
    return `${lines.join('\n')};`;
  }

  for (const join of relationships) {
    const leftTable = selectedSources.find((table) => table.tableId === join.leftTableId);
    const rightTable = selectedSources.find((table) => table.tableId === join.rightTableId);
    const conditions = (join.conditions ?? []).filter(
      (condition) => condition.leftColumn && condition.rightColumn,
    );
    if (!leftTable || !rightTable || conditions.length === 0) {
      continue;
    }

    const leftAlias = aliasByTableId[leftTable.tableId] ?? 'a';
    const rightAlias = aliasByTableId[rightTable.tableId] ?? 'b';
    const joinType = join.joinType ?? 'INNER';
    lines.push(
      `  ${joinType} JOIN ${renderFromTable(rightTable, rightAlias, derivedSources)}`,
    );
    lines.push(
      `    ON ${conditions
        .map(
          (condition) =>
            `${leftAlias}.${condition.leftColumn} ${condition.operator ?? '='} ${rightAlias}.${condition.rightColumn}`,
        )
        .join('\n    AND ')}`,
    );
  }

  return `${lines.join('\n')};`;
}

export type PreProcessValidationChecks = {
  expressionDefined: boolean;
  sourceColumnReferenced: boolean;
  noPlaceholderTokens: boolean;
};

const PLACEHOLDER_PATTERN = /(\{\{|\}\}|<<|>>|\bTBD\b|\bTODO\b|<column>|\.\.\.)/i;

type TableRef = { database: string; schema: string; table: string };

function makeTableRef(qualifiedName: string): TableRef {
  const [database, schema, table] = qualifiedName.split('.', 3);
  return { database, schema, table };
}

export function buildPreProcessValidatePayload(
  sqlText: string,
  sources: TableNode[],
  relationships: JoinConfig[],
  sourceAttributeGroups: ColumnGroup[],
  drivingTableId: string | null,
) {
  const selectedSources = sources.filter((source) => source.isSelected);
  const driving =
    selectedSources.find((source) => source.tableId === drivingTableId) ??
    selectedSources[0] ??
    null;

  const selected_columns_by_table: Record<string, string[]> = {};
  for (const group of sourceAttributeGroups) {
    const names = group.columns
      .filter((column) => column.name)
      .map((column) => String(column.name));
    if (names.length) {
      selected_columns_by_table[group.qualifiedName] = names;
    }
  }

  const relationshipPayload = relationships
    .filter((join) => join.leftTableId && join.rightTableId && join.conditions?.length)
    .map((join) => {
      const left = selectedSources.find((source) => source.tableId === join.leftTableId);
      const right = selectedSources.find((source) => source.tableId === join.rightTableId);
      if (!left || !right) {
        return null;
      }
      const conditions = (join.conditions ?? [])
        .filter((condition) => condition.leftColumn && condition.rightColumn)
        .map((condition) => ({
          left_column: String(condition.leftColumn),
          right_column: String(condition.rightColumn),
          operator: condition.operator ?? '=',
        }));
      if (!conditions.length) {
        return null;
      }
      return {
        left_table: makeTableRef(left.qualifiedName),
        right_table: makeTableRef(right.qualifiedName),
        join_type: join.joinType ?? 'INNER',
        constraint_name: join.constraintName ?? null,
        source: join.source ?? 'USER_DEFINED',
        locked: join.locked ?? false,
        conditions,
      };
    })
    .filter((join): join is NonNullable<typeof join> => join !== null);

  return {
    derived_source_name: 'Pre-process preview',
    sql_text: sqlText,
    source_tables: selectedSources.map((source) => makeTableRef(source.qualifiedName)),
    driving_table: driving ? makeTableRef(driving.qualifiedName) : null,
    relationships: relationshipPayload,
    selected_columns_by_table,
  };
}

export function evaluatePreProcessChecks(
  expression: string,
  sourceAttributeGroups: ColumnGroup[],
  mappedSourceColumn?: string | null,
): PreProcessValidationChecks {
  const trimmed = expression.trim();
  const normalizedExpression = trimmed.toLowerCase();

  const knownColumns = sourceAttributeGroups.flatMap((group) => {
    const alias = tableAlias(group.table);
    return (group.columns ?? [])
      .filter((column) => column.name)
      .flatMap((column) => [
        String(column.name).toLowerCase(),
        `${alias}.${String(column.name).toLowerCase()}`,
      ]);
  });

  const mappedSource = mappedSourceColumn?.trim().toLowerCase() ?? '';
  const referencesMappedSource =
    !!mappedSource && normalizedExpression.includes(mappedSource);

  const referencesKnownColumn = knownColumns.some((column) =>
    normalizedExpression.includes(column),
  );

  return {
    expressionDefined: trimmed.length > 0,
    sourceColumnReferenced: referencesMappedSource || referencesKnownColumn,
    noPlaceholderTokens: trimmed.length > 0 && !PLACEHOLDER_PATTERN.test(trimmed),
  };
}
