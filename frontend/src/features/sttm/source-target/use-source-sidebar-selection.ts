"use client";

import { useCallback, useRef, useState } from "react";
import type { SourceWorkspaceDragItem } from "@/features/sttm/source-target/source-workspace-dnd";
import { sourceSidebarSelectionKey } from "@/features/sttm/source-target/source-workspace-dnd";

export function useSourceSidebarSelection() {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const anchorKeyRef = useRef<string | null>(null);

  const isSelected = useCallback((key: string) => selectedKeys.has(key), [selectedKeys]);

  const handleSelect = useCallback(
    (key: string, event: React.MouseEvent, orderedTableKeys: string[] = []) => {
      const isMulti = event.metaKey || event.ctrlKey;
      const isRange = event.shiftKey;

      if (isRange && orderedTableKeys.length > 0 && anchorKeyRef.current) {
        const start = orderedTableKeys.indexOf(anchorKeyRef.current);
        const end = orderedTableKeys.indexOf(key);
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          setSelectedKeys(new Set(orderedTableKeys.slice(from, to + 1)));
          return;
        }
      }

      if (isMulti) {
        setSelectedKeys((previous) => {
          const next = new Set(previous);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
      } else {
        setSelectedKeys(new Set([key]));
      }

      anchorKeyRef.current = key;
    },
    [],
  );

  const resolveDragItems = useCallback(
    (
      draggedKey: string,
      resolveNode: (key: string) => SourceWorkspaceDragItem | null,
    ): SourceWorkspaceDragItem[] => {
      const keys = selectedKeys.has(draggedKey) ? [...selectedKeys] : [draggedKey];
      const items: SourceWorkspaceDragItem[] = [];
      const seen = new Set<string>();

      for (const key of keys) {
        const item = resolveNode(key);
        if (!item) {
          continue;
        }
        const dedupeKey =
          item.kind === "table"
            ? `table:${item.tableId}`
            : item.kind === "schema"
              ? `schema:${item.schemaId}`
              : `database:${item.dbId}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        items.push(item);
      }

      return items;
    },
    [selectedKeys],
  );

  const selectionKeyForDatabase = (dbId: string) =>
    sourceSidebarSelectionKey("database", { dbId });

  const selectionKeyForSchema = (schemaId: string) =>
    sourceSidebarSelectionKey("schema", { schemaId });

  const selectionKeyForTable = (tableId: string) =>
    sourceSidebarSelectionKey("table", { tableId });

  return {
    isSelected,
    handleSelect,
    resolveDragItems,
    selectionKeyForDatabase,
    selectionKeyForSchema,
    selectionKeyForTable,
  };
}
