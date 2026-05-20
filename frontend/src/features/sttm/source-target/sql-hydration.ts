import type { JoinConfig, TableMeta } from "@/features/sttm/types/sttm.types";
import type { RuleCondition, RuleGroup, RuleLogic } from "./filter-conditions";

export type DetectedFunction = {
  name: string;
  category: "aggregate" | "window" | "string" | "conditional" | "date" | "math" | "other";
};

export type ComputedColumn = {
  alias: string;
  expression: string;
  functions: DetectedFunction[];
};

export type QueryClauseSummary = {
  groupBy: string[];
  having: string | null;
  orderBy: string[];
};

export type SqlHydrationResult = {
  selectedTableIds: string[];
  drivingTableId: string | null;
  selectedColumnsByTable: Record<string, string[]>;
  joins: JoinConfig[];
  filterGroups: RuleGroup[];
  detectedFunctions: DetectedFunction[];
  computedColumns: ComputedColumn[];
  clauses: QueryClauseSummary;
};

type SegmentMap = {
  select: string;
  from: string;
  where: string | null;
  groupBy: string | null;
  having: string | null;
  orderBy: string | null;
  cteSection: string | null;
};

type AliasBinding = {
  alias: string;
  tableId: string | null;
};

const KEYWORDS = [
  "select",
  "from",
  "where",
  "group by",
  "having",
  "order by",
] as const;

const FUNCTION_CATEGORY_LOOKUP: Record<string, DetectedFunction["category"]> = {
  count: "aggregate",
  sum: "aggregate",
  avg: "aggregate",
  min: "aggregate",
  max: "aggregate",
  listagg: "aggregate",
  array_agg: "aggregate",
  object_agg: "aggregate",
  stddev: "aggregate",
  variance: "aggregate",
  row_number: "window",
  rank: "window",
  dense_rank: "window",
  lag: "window",
  lead: "window",
  first_value: "window",
  last_value: "window",
  nth_value: "window",
  concat: "string",
  concat_ws: "string",
  substr: "string",
  substring: "string",
  upper: "string",
  lower: "string",
  trim: "string",
  replace: "string",
  regexp_replace: "string",
  coalesce: "conditional",
  nvl: "conditional",
  iff: "conditional",
  case: "conditional",
  date_trunc: "date",
  datediff: "date",
  dateadd: "date",
  to_date: "date",
  round: "math",
  abs: "math",
  ceil: "math",
  floor: "math",
};

function generateId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripSqlComments(value: string) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ")
    .replace(/;+\s*$/g, "")
    .trim();
}

function trimWrappingParens(value: string) {
  let next = value.trim();
  while (next.startsWith("(") && next.endsWith(")") && isBalanced(next.slice(1, -1))) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

function isBalanced(value: string) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "'" && !inDouble && value[i - 1] !== "\\") inSingle = !inSingle;
    else if (char === '"' && !inSingle && value[i - 1] !== "\\") inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !inSingle && !inDouble;
}

function splitTopLevel(value: string, delimiter: string) {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  const source = value;
  const delimiterLower = delimiter.toLowerCase();

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "'" && !inDouble && source[i - 1] !== "\\") {
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === '"' && !inSingle && source[i - 1] !== "\\") {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (char === "(") depth += 1;
      else if (char === ")" && depth > 0) depth -= 1;

      if (depth === 0) {
        const segment = source.slice(i, i + delimiter.length).toLowerCase();
        const before = source[i - 1];
        const after = source[i + delimiter.length];
        const isCommaDelimiter = delimiter === ",";
        const boundaryBefore = isCommaDelimiter ? true : !before || /[\s(]/.test(before);
        const boundaryAfter = isCommaDelimiter ? true : !after || /[\s)]/.test(after);
        if (segment === delimiterLower && boundaryBefore && boundaryAfter) {
          if (current.trim()) parts.push(current.trim());
          current = "";
          i += delimiter.length - 1;
          continue;
        }
      }
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitSelectExpressions(selectClause: string) {
  return splitTopLevel(selectClause, ",");
}

function findTopLevelKeyword(value: string, keyword: string, startIndex = 0) {
  const lower = value.toLowerCase();
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = startIndex; i < value.length; i += 1) {
    const char = value[i];
    if (char === "'" && !inDouble && value[i - 1] !== "\\") {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle && value[i - 1] !== "\\") {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (lower.slice(i, i + keyword.length) !== keyword) continue;
    const before = lower[i - 1];
    const after = lower[i + keyword.length];
    const boundaryBefore = !before || /[\s,(]/.test(before);
    const boundaryAfter = !after || /[\s(]/.test(after);
    if (boundaryBefore && boundaryAfter) return i;
  }
  return -1;
}

function parseSegments(sqlText: string): SegmentMap | null {
  const sql = stripSqlComments(sqlText);
  if (!sql) return null;

  const selectIndex = findTopLevelKeyword(sql, "select");
  const fromIndex = findTopLevelKeyword(sql, "from", selectIndex + 6);
  if (selectIndex === -1 || fromIndex === -1) return null;

  const whereIndex = findTopLevelKeyword(sql, "where", fromIndex + 4);
  const groupByIndex = findTopLevelKeyword(sql, "group by", fromIndex + 4);
  const havingIndex = findTopLevelKeyword(sql, "having", fromIndex + 4);
  const orderByIndex = findTopLevelKeyword(sql, "order by", fromIndex + 4);

  const sectionEnd = (...indexes: number[]) =>
    indexes.filter((index) => index !== -1).sort((a, b) => a - b)[0] ?? sql.length;

  const select = sql.slice(selectIndex + 6, fromIndex).trim();
  const from = sql.slice(fromIndex + 4, sectionEnd(whereIndex, groupByIndex, havingIndex, orderByIndex)).trim();
  const where =
    whereIndex === -1
      ? null
      : sql
          .slice(whereIndex + 5, sectionEnd(groupByIndex, havingIndex, orderByIndex))
          .trim();
  const groupBy =
    groupByIndex === -1
      ? null
      : sql
          .slice(groupByIndex + "group by".length, sectionEnd(havingIndex, orderByIndex))
          .trim();
  const having =
    havingIndex === -1
      ? null
      : sql.slice(havingIndex + 6, sectionEnd(orderByIndex)).trim();
  const orderBy =
    orderByIndex === -1 ? null : sql.slice(orderByIndex + "order by".length).trim();
  const cteSection = selectIndex > 0 && sql.slice(0, selectIndex).trim().toLowerCase().startsWith("with")
    ? sql.slice(0, selectIndex).trim()
    : null;

  return { select, from, where, groupBy, having, orderBy, cteSection };
}

function resolveTableId(
  sourceToken: string,
  availableTables: TableMeta[],
  cteMap: Map<string, string>,
) {
  const token = sourceToken.replace(/^"+|"+$/g, "");
  const tokenLower = token.toLowerCase();
  const cteTarget = cteMap.get(tokenLower);
  if (cteTarget) return cteTarget;

  const normalizedToken = tokenLower.replace(/^_+/, "");

  const tokenParts = token.split(".");
  return (
    availableTables.find((table) => {
      const tableId = String(table.id ?? "");
      const qualified = `${table.database}.${table.schema}.${table.name}`.toLowerCase();
      const flattenedQualified = `${table.database}_${table.schema}_${table.name}`
        .replace(/[^a-z0-9]+/gi, "_")
        .toLowerCase();
      const flattenedTable = `${table.schema}_${table.name}`
        .replace(/[^a-z0-9]+/gi, "_")
        .toLowerCase();
      if (qualified === tokenLower || tableId.toLowerCase() === tokenLower) return true;
      if ((table.name ?? "").toLowerCase() === tokenLower) return true;
      if (normalizedToken === flattenedQualified || normalizedToken === flattenedTable) return true;
      if (normalizedToken.endsWith(`_${(table.name ?? "").toLowerCase()}`)) return true;
      if (tokenParts.length === 2) {
        return `${table.schema}.${table.name}`.toLowerCase() === tokenLower;
      }
      return false;
    })?.id ?? null
  ) as string | null;
}

function getTableById(tableId: string | null, availableTables: TableMeta[]) {
  if (!tableId) return null;
  return availableTables.find((table) => String(table.id ?? "") === tableId) ?? null;
}

function canonicalizeColumnName(
  tableId: string | null,
  columnName: string,
  availableTables: TableMeta[],
) {
  const cleaned = columnName.replace(/^"+|"+$/g, "");
  const table = getTableById(tableId, availableTables);
  const matched = table?.columns?.find(
    (column) => String(column.name ?? "").toLowerCase() === cleaned.toLowerCase(),
  );
  return String(matched?.name ?? cleaned);
}

function buildCteMap(cteSection: string | null, availableTables: TableMeta[]) {
  const map = new Map<string, string>();
  if (!cteSection) return map;
  const body = cteSection.replace(/^with\s+/i, "").trim();
  const entries = splitTopLevel(body, ",");
  for (const entry of entries) {
    const match = entry.match(/^("?[\w$]+"?)\s+as\s*\(([\s\S]*)\)$/i);
    if (!match) continue;
    const [, rawName, rawBody] = match;
    const name = rawName.replace(/^"+|"+$/g, "").toLowerCase();
    const fromMatch = rawBody.match(/\bfrom\s+([A-Za-z0-9_."$]+)\b/i);
    if (!fromMatch) continue;
    const resolved = resolveTableId(fromMatch[1], availableTables, new Map());
    if (resolved) map.set(name, resolved);
  }
  return map;
}

function parseFromAndJoins(
  fromClause: string,
  availableTables: TableMeta[],
  cteMap: Map<string, string>,
) {
  const normalized = normalizeWhitespace(fromClause);
  const joinRegex =
    /\b(?:(inner|left|right|full)(?:\s+outer)?\s+)?join\s+([A-Za-z0-9_."$]+)(?:\s+(?:as\s+)?([A-Za-z0-9_."$]+))?\s+on\s+([\s\S]*?)(?=(?:\b(?:inner|left|right|full)(?:\s+outer)?\s+join\b)|$)/gi;
  const rootMatch = normalized.match(/^([A-Za-z0-9_."$]+)(?:\s+(?:as\s+)?([A-Za-z0-9_."$]+))?/i);
  if (!rootMatch) {
    return {
      drivingTableId: null,
      selectedTableIds: [] as string[],
      joins: [] as JoinConfig[],
      aliasBindings: [] as AliasBinding[],
    };
  }

  const selectedTableIds: string[] = [];
  const aliasBindings: AliasBinding[] = [];
  const rootTableId = resolveTableId(rootMatch[1], availableTables, cteMap);
  const rootAlias = (rootMatch[2] ?? rootMatch[1]).replace(/^"+|"+$/g, "");
  if (rootTableId) {
    selectedTableIds.push(rootTableId);
    aliasBindings.push({ alias: rootAlias.toLowerCase(), tableId: rootTableId });
  }

  const joins: JoinConfig[] = [];
  let match: RegExpExecArray | null;
  while ((match = joinRegex.exec(normalized))) {
    const joinType = (match[1]?.toUpperCase() ?? "INNER") as JoinConfig["joinType"];
    const tableId = resolveTableId(match[2], availableTables, cteMap);
    const alias = (match[3] ?? match[2]).replace(/^"+|"+$/g, "").toLowerCase();
    if (tableId && !selectedTableIds.includes(tableId)) selectedTableIds.push(tableId);
    if (tableId) aliasBindings.push({ alias, tableId });

    const onConditions = splitTopLevel(match[4], "and")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((condition) => {
        const binary = condition.match(
          /^("?[\w$]+"?)\."?([\w$]+)"?\s*(=|!=|<>|>=|<=|>|<)\s*("?[\w$]+"?)\."?([\w$]+)"?$/i,
        );
        if (!binary) return null;
        const leftAlias = binary[1].replace(/^"+|"+$/g, "").toLowerCase();
        const rightAlias = binary[4].replace(/^"+|"+$/g, "").toLowerCase();
        const leftTableId = aliasBindings.find((binding) => binding.alias === leftAlias)?.tableId ?? null;
        const rightTableId = tableId && alias === rightAlias
          ? tableId
          : aliasBindings.find((binding) => binding.alias === rightAlias)?.tableId ?? null;
        if (!leftTableId || !rightTableId) return null;
        return {
          leftTableId,
          rightTableId,
          leftColumn: canonicalizeColumnName(leftTableId, binary[2], availableTables),
          operator: binary[3] === "<>" ? "!=" : binary[3],
          rightColumn: canonicalizeColumnName(rightTableId, binary[5], availableTables),
        };
      })
      .filter(Boolean) as Array<{
      leftTableId: string;
      rightTableId: string;
      leftColumn: string;
      operator: string;
      rightColumn: string;
    }>;

    if (!onConditions.length) continue;
    const first = onConditions[0];
    joins.push({
      id: generateId("join"),
      joinType,
      leftTableId: first.leftTableId,
      rightTableId: first.rightTableId,
      source: "USER_DEFINED",
      locked: false,
      conditions: onConditions.map((condition) => ({
        leftColumn: condition.leftColumn,
        operator: condition.operator,
        rightColumn: condition.rightColumn,
      })),
    });
  }

  return {
    drivingTableId: rootTableId,
    selectedTableIds,
    joins,
    aliasBindings,
  };
}

function detectFunctions(expression: string): DetectedFunction[] {
  const found = new Map<string, DetectedFunction>();
  const functionRegex = /\b([a-z_][a-z0-9_]*)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = functionRegex.exec(expression))) {
    const name = match[1].toLowerCase();
    const category = FUNCTION_CATEGORY_LOOKUP[name] ?? "other";
    found.set(name, { name: name.toUpperCase(), category });
  }
  if (/\bover\s*\(/i.test(expression) && !found.has("OVER")) {
    found.set("OVER", { name: "OVER", category: "window" });
  }
  if (/\bcase\b/i.test(expression) && !found.has("CASE")) {
    found.set("CASE", { name: "CASE", category: "conditional" });
  }
  return Array.from(found.values());
}

function parseSelectClause(
  selectClause: string,
  aliasBindings: AliasBinding[],
  availableTables: TableMeta[],
) {
  const aliasToTableId = new Map(
    aliasBindings.filter((binding) => binding.tableId).map((binding) => [binding.alias, binding.tableId as string]),
  );
  const selectedColumnsByTable: Record<string, string[]> = {};
  const computedColumns: ComputedColumn[] = [];
  const detectedFunctions = new Map<string, DetectedFunction>();

  for (const expression of splitSelectExpressions(selectClause)) {
    const cleanExpression = expression.trim();
    const columnRefs = Array.from(
      cleanExpression.matchAll(/("?[\w$]+"?)\."?([\w$]+)"?/g),
    ).map((match) => ({
      alias: match[1].replace(/^"+|"+$/g, "").toLowerCase(),
      column: match[2],
    }));

    for (const columnRef of columnRefs) {
      const tableId = aliasToTableId.get(columnRef.alias);
      if (!tableId) continue;
      if (!selectedColumnsByTable[tableId]) selectedColumnsByTable[tableId] = [];
      const canonicalColumn = canonicalizeColumnName(tableId, columnRef.column, availableTables);
      if (!selectedColumnsByTable[tableId].includes(canonicalColumn)) {
        selectedColumnsByTable[tableId].push(canonicalColumn);
      }
    }

    const functions = detectFunctions(cleanExpression);
    for (const fn of functions) detectedFunctions.set(fn.name, fn);
    if (!functions.length) continue;

    const aliasMatch = cleanExpression.match(/\bas\s+("?[\w$]+"?)$/i);
    const fallbackAlias = cleanExpression
      .split(".")
      .pop()
      ?.replace(/^"+|"+$/g, "")
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .slice(0, 64);
    computedColumns.push({
      alias: (aliasMatch?.[1] ?? fallbackAlias ?? `expr_${computedColumns.length + 1}`).replace(/^"+|"+$/g, ""),
      expression: cleanExpression,
      functions,
    });
  }

  return {
    selectedColumnsByTable,
    computedColumns,
    detectedFunctions: Array.from(detectedFunctions.values()),
  };
}

function tableFieldPrefixForId(tableId: string, availableTables: TableMeta[]) {
  const table = availableTables.find((item) => item.id === tableId);
  if (!table?.schema || !table?.name) return null;
  return `${table.schema}.${table.name}`;
}

function fieldTokenToUiValue(
  field: string,
  aliasToTableId: Map<string, string>,
  availableTables: TableMeta[],
) {
  const unwrapFieldExpression = (raw: string): string => {
    const trimmed = raw.trim();
    const directField = trimmed.match(/^("?[\w$]+"?)\."?([\w$]+)"?$/);
    if (directField) return trimmed;

    const wrapperMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]+)\)$/);
    if (!wrapperMatch || !isBalanced(trimmed)) return trimmed;

    const innerArgs = splitTopLevel(wrapperMatch[2], ",");
    if (!innerArgs.length) return trimmed;
    return unwrapFieldExpression(innerArgs[0].trim());
  };

  const cleaned = unwrapFieldExpression(field).replace(/^"+|"+$/g, "");
  const aliasedMatch = cleaned.match(/^([A-Za-z0-9_$"]+)\.([A-Za-z0-9_$"]+)$/);
  if (aliasedMatch) {
    const alias = aliasedMatch[1].replace(/^"+|"+$/g, "").toLowerCase();
    const tableId = aliasToTableId.get(alias);
    const column = canonicalizeColumnName(
      tableId ?? null,
      aliasedMatch[2].replace(/^"+|"+$/g, ""),
      availableTables,
    );
    const prefix = tableId ? tableFieldPrefixForId(tableId, availableTables) : null;
    if (prefix) return `${prefix}.${column}`;
  }
  const parts = cleaned.split(".");
  if (parts.length >= 3) {
    const schemaName = parts[parts.length - 3];
    const tableName = parts[parts.length - 2];
    const columnName = parts[parts.length - 1];
    const table = availableTables.find(
      (item) =>
        String(item.schema ?? "").toLowerCase() === schemaName.toLowerCase() &&
        String(item.name ?? "").toLowerCase() === tableName.toLowerCase(),
    );
    const canonicalColumn = canonicalizeColumnName(
      String(table?.id ?? ""),
      columnName,
      availableTables,
    );
    return `${schemaName}.${tableName}.${canonicalColumn}`;
  }
  return cleaned;
}

function normalizeLiteral(raw: string) {
  const trimmed = raw.trim();
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

function parseLeafCondition(
  expression: string,
  aliasToTableId: Map<string, string>,
  availableTables: TableMeta[],
): RuleCondition | RuleGroup | null {
  const trimmed = trimWrappingParens(expression);
  if (!trimmed) return null;

  const negatedNullMatch = trimmed.match(/^not\s+(.+?)\s+is\s+null$/i);
  if (negatedNullMatch) {
    return {
      id: generateId("cond"),
      type: "condition",
      field: fieldTokenToUiValue(negatedNullMatch[1].trim(), aliasToTableId, availableTables),
      operator: "IS NOT NULL",
      value: "",
      valueMode: "literal",
    };
  }

  const nullMatch = trimmed.match(/^(.+?)\s+(is\s+not\s+null|is\s+null)$/i);
  if (nullMatch) {
    return {
      id: generateId("cond"),
      type: "condition",
      field: fieldTokenToUiValue(nullMatch[1].trim(), aliasToTableId, availableTables),
      operator: nullMatch[2].toUpperCase().replace(/\s+/g, " "),
      value: "",
      valueMode: "literal",
    };
  }

  const betweenMatch = trimmed.match(/^(.+?)\s+(not\s+between|between)\s+(.+?)\s+and\s+(.+)$/i);
  if (betweenMatch) {
    return {
      id: generateId("cond"),
      type: "condition",
      field: fieldTokenToUiValue(betweenMatch[1].trim(), aliasToTableId, availableTables),
      operator: betweenMatch[2].toUpperCase().replace(/\s+/g, " "),
      value: normalizeLiteral(betweenMatch[3]),
      secondaryValue: normalizeLiteral(betweenMatch[4]),
      valueMode: "literal",
      secondaryValueMode: "literal",
    };
  }

  const inMatch = trimmed.match(/^(.+?)\s+(not\s+in|in)\s*\((.+)\)$/i);
  if (inMatch) {
    return {
      id: generateId("cond"),
      type: "condition",
      field: fieldTokenToUiValue(inMatch[1].trim(), aliasToTableId, availableTables),
      operator: inMatch[2].toUpperCase().replace(/\s+/g, " "),
      value: splitTopLevel(inMatch[3], ",").map(normalizeLiteral).join(", "),
      valueMode: "literal",
    };
  }

  const binaryMatch = trimmed.match(
    /^(.+?)\s*(=|!=|<>|>=|<=|>|<|like|ilike)\s*(.+)$/i,
  );
  if (binaryMatch) {
    const rhs = binaryMatch[3].trim();
    const rhsLooksLikeField =
      !/^'.*'$/.test(rhs) &&
      /^[A-Za-z_][A-Za-z0-9_$."]+$/.test(rhs) &&
      rhs.includes(".");
    return {
      id: generateId("cond"),
      type: "condition",
      field: fieldTokenToUiValue(binaryMatch[1].trim(), aliasToTableId, availableTables),
      operator: binaryMatch[2].toUpperCase() === "<>" ? "!=" : binaryMatch[2].toUpperCase(),
      value: rhsLooksLikeField ? "" : normalizeLiteral(rhs),
      valueMode: rhsLooksLikeField ? "field" : "literal",
      valueField: rhsLooksLikeField ? fieldTokenToUiValue(rhs, aliasToTableId, availableTables) : "",
    };
  }

  return {
    id: generateId("group"),
    type: "group",
    logic: "AND",
    children: [
      {
        id: generateId("cond"),
        type: "condition",
        field: "",
        operator: "=",
        value: normalizeWhitespace(trimmed),
        valueMode: "literal",
      },
    ],
  };
}

function parseConditionTree(
  expression: string,
  aliasToTableId: Map<string, string>,
  availableTables: TableMeta[],
): RuleNodeLike | null {
  const trimmed = trimWrappingParens(expression);
  if (!trimmed) return null;

  const orParts = splitTopLevel(trimmed, "or");
  if (orParts.length > 1) {
    return {
      id: generateId("group"),
      type: "group",
      logic: "OR",
      children: orParts
        .map((part) => parseConditionTree(part, aliasToTableId, availableTables))
        .filter(Boolean) as RuleNodeLike[],
    };
  }

  const andParts = splitTopLevel(trimmed, "and");
  if (andParts.length > 1) {
    return {
      id: generateId("group"),
      type: "group",
      logic: "AND",
      children: andParts
        .map((part) => parseConditionTree(part, aliasToTableId, availableTables))
        .filter(Boolean) as RuleNodeLike[],
    };
  }

  if (/^not\s*\(/i.test(trimmed) && trimmed.endsWith(")")) {
    const inner = trimmed.replace(/^not\s*\(/i, "").slice(0, -1);
    const child = parseConditionTree(inner, aliasToTableId, availableTables);
    return child
      ? {
          id: generateId("group"),
          type: "group",
          logic: "NOT",
          children: [child],
        }
      : null;
  }

  return parseLeafCondition(trimmed, aliasToTableId, availableTables);
}

type RuleNodeLike = RuleGroup | RuleCondition;

function toRootGroups(
  whereClause: string | null,
  aliasToTableId: Map<string, string>,
  availableTables: TableMeta[],
): RuleGroup[] {
  if (!whereClause?.trim()) return [];
  const root = parseConditionTree(whereClause, aliasToTableId, availableTables);
  if (!root) return [];
  if (root.type === "group") return [root];
  return [
    {
      id: generateId("group"),
      type: "group",
      logic: "AND",
      children: [root],
    },
  ];
}

function parseGroupBy(
  groupByClause: string | null,
  aliasToTableId: Map<string, string>,
  availableTables: TableMeta[],
) {
  if (!groupByClause?.trim()) return [];
  return splitTopLevel(groupByClause, ",").map((item) =>
    fieldTokenToUiValue(item.trim(), aliasToTableId, availableTables),
  );
}

function parseOrderBy(
  orderByClause: string | null,
  aliasToTableId: Map<string, string>,
  availableTables: TableMeta[],
) {
  if (!orderByClause?.trim()) return [];
  return splitTopLevel(orderByClause, ",").map((item) => {
    const normalized = normalizeWhitespace(item);
    const match = normalized.match(/^(.*?)(?:\s+(ASC|DESC))?$/i);
    const field = match?.[1]?.trim() ?? normalized;
    const direction = match?.[2]?.toUpperCase() ?? "ASC";
    return `${fieldTokenToUiValue(field, aliasToTableId, availableTables)} ${direction}`;
  });
}

export function suggestBusinessName(
  requestSummary: string | null | undefined,
  tables: TableMeta[],
) {
  const text = (requestSummary ?? "").toLowerCase();
  const parts: string[] = [];

  const phraseMappings: Array<[RegExp, string]> = [
    [/\bmetadata mapping report\b/, "metadata_mapping_report"],
    [/\bbusiness attributes?\b/, "business_attributes"],
    [/\bproject status\b/, "project_status"],
    [/\bsource columns?\b/, "source_columns"],
    [/\btransformation logic\b/, "transformation_logic"],
    [/\bcalculation rules?\b/, "calculation_rules"],
    [/\bcustomer\b/, "customer"],
    [/\border\b/, "orders"],
    [/\brevenue\b/, "revenue"],
  ];

  for (const [pattern, replacement] of phraseMappings) {
    if (pattern.test(text) && !parts.includes(replacement)) parts.push(replacement);
  }

  if (!parts.length) {
    for (const table of tables.slice(0, 3)) {
      const cleaned = (table.name ?? "")
        .replace(/^tbl_/i, "")
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
      if (cleaned) parts.push(cleaned);
    }
  }

  const finalName = parts.filter(Boolean).slice(0, 4).join("_") || "derived_source";
  return finalName.slice(0, 64);
}

export function hydrateBuilderFromSql(
  sqlText: string,
  availableTables: TableMeta[],
): SqlHydrationResult | null {
  const segments = parseSegments(sqlText);
  if (!segments) return null;

  const cteMap = buildCteMap(segments.cteSection, availableTables);
  const { drivingTableId, selectedTableIds, joins, aliasBindings } = parseFromAndJoins(
    segments.from,
    availableTables,
    cteMap,
  );
  const aliasToTableId = new Map(
    aliasBindings.filter((binding) => binding.tableId).map((binding) => [binding.alias, binding.tableId as string]),
  );
  const { selectedColumnsByTable, computedColumns, detectedFunctions } = parseSelectClause(
    segments.select,
    aliasBindings,
    availableTables,
  );
  const filterGroups = toRootGroups(segments.where, aliasToTableId, availableTables);
  const selectedFromAliases = Array.from(new Set(aliasBindings.map((binding) => binding.tableId).filter(Boolean))) as string[];
  const normalizedSelectedTableIds = Array.from(
    new Set([...selectedTableIds, ...selectedFromAliases, ...Object.keys(selectedColumnsByTable)]),
  );

  return {
    selectedTableIds: normalizedSelectedTableIds,
    drivingTableId,
    selectedColumnsByTable,
    joins,
    filterGroups,
    detectedFunctions,
    computedColumns,
    clauses: {
      groupBy: parseGroupBy(segments.groupBy, aliasToTableId, availableTables),
      having: segments.having ? normalizeWhitespace(segments.having) : null,
      orderBy: parseOrderBy(segments.orderBy, aliasToTableId, availableTables),
    },
  };
}
