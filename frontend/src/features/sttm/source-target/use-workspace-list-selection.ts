"use client";

import { useCallback, useRef, useState } from "react";

export function useWorkspaceListSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorIdRef = useRef<string | null>(null);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const handleSelect = useCallback(
    (id: string, event: React.MouseEvent, orderedIds: string[] = []) => {
      const isMulti = event.metaKey || event.ctrlKey;
      const isRange = event.shiftKey;

      if (isRange && orderedIds.length > 0 && anchorIdRef.current) {
        const start = orderedIds.indexOf(anchorIdRef.current);
        const end = orderedIds.indexOf(id);
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          setSelectedIds(new Set(orderedIds.slice(from, to + 1)));
          return;
        }
      }

      if (isMulti) {
        setSelectedIds((previous) => {
          const next = new Set(previous);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
      } else {
        setSelectedIds((previous) => {
          // Plain click toggles off when it's the only selected item.
          if (previous.size === 1 && previous.has(id)) {
            return new Set();
          }
          return new Set([id]);
        });
      }

      anchorIdRef.current = id;
    },
    [],
  );

  const clearSelected = useCallback(() => {
    setSelectedIds(new Set());
    anchorIdRef.current = null;
  }, []);

  const pruneSelected = useCallback((validIds: Set<string>) => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, []);

  return {
    selectedIds,
    isSelected,
    handleSelect,
    clearSelected,
    pruneSelected,
  };
}
