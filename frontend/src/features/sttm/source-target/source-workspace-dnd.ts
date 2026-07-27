export const SOURCE_WORKSPACE_MIME = "application/x-sttm-source-workspace";
export const WORKSPACE_DRAG_MIME = SOURCE_WORKSPACE_MIME;

export type SourceWorkspaceDragItem =
  | { kind: "database"; dbId: string }
  | { kind: "schema"; dbId: string; schemaId: string }
  | { kind: "table"; tableId: string };

export type SourceWorkspaceDragPayload = {
  items: SourceWorkspaceDragItem[];
};

export type SourceSidebarNodeKind = "database" | "schema" | "table";

export function sourceSidebarSelectionKey(
  kind: SourceSidebarNodeKind,
  ids: { dbId?: string; schemaId?: string; tableId?: string },
): string {
  if (kind === "database" && ids.dbId) {
    return `database:${ids.dbId}`;
  }
  if (kind === "schema" && ids.schemaId) {
    return `schema:${ids.schemaId}`;
  }
  if (kind === "table" && ids.tableId) {
    return `table:${ids.tableId}`;
  }
  return "";
}

export function parseWorkspaceDragPayload(
  dataTransfer: DataTransfer,
): SourceWorkspaceDragPayload | null {
  return parseSourceWorkspaceDragPayload(dataTransfer);
}

export function writeWorkspaceDragPayload(
  dataTransfer: DataTransfer,
  payload: SourceWorkspaceDragPayload,
) {
  writeSourceWorkspaceDragPayload(dataTransfer, payload);
}

export function parseSourceWorkspaceDragPayload(
  dataTransfer: DataTransfer,
): SourceWorkspaceDragPayload | null {
  const raw = dataTransfer.getData(SOURCE_WORKSPACE_MIME);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SourceWorkspaceDragPayload;
    if (!parsed?.items?.length) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSourceWorkspaceDragPayload(
  dataTransfer: DataTransfer,
  payload: SourceWorkspaceDragPayload,
) {
  dataTransfer.setData(SOURCE_WORKSPACE_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "copy";
}

export function parseQualifiedTablePath(qualifiedName: string) {
  const [dbName, schemaName, tableName] = qualifiedName.split(".");
  return { dbName, schemaName, tableName };
}

export const DERIVED_WORKSPACE_MIME = "application/x-sttm-derived-workspace";

export type DerivedWorkspaceDragPayload = {
  derivedSourceIds: string[];
};

export function writeDerivedWorkspaceDragPayload(
  dataTransfer: DataTransfer,
  payload: DerivedWorkspaceDragPayload,
) {
  dataTransfer.setData(DERIVED_WORKSPACE_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "copy";
}

export function parseDerivedWorkspaceDragPayload(
  dataTransfer: DataTransfer,
): DerivedWorkspaceDragPayload | null {
  const raw = dataTransfer.getData(DERIVED_WORKSPACE_MIME);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as DerivedWorkspaceDragPayload;
    if (!parsed?.derivedSourceIds?.length) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
