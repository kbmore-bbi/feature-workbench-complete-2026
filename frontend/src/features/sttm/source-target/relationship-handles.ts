type TableHandleRef = {
  database?: string;
  schema?: string;
  name?: string;
  label?: string;
};

export function buildTableHeaderHandleKey(
  table: TableHandleRef,
  kind: "source" | "target",
) {
  const tableName = table.name ?? table.label ?? "table";
  return `${table.database ?? "—"}.${table.schema ?? "—"}.${tableName}-header-${kind}`;
}

export function resolveTableHeaderHandleId(
  table: TableHandleRef | undefined,
  kind: "source" | "target",
) {
  if (!table) return undefined;
  return buildTableHeaderHandleKey(table, kind);
}

export function isTableHeaderHandle(handleId: string | null | undefined) {
  if (!handleId) return false;
  return handleId.endsWith("-header-source") || handleId.endsWith("-header-target");
}
