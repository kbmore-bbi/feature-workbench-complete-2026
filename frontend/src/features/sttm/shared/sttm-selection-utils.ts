import type { DatabaseNode, DerivedSource, TableNode } from '@/features/sttm/types/sttm.types';

function flattenSelectedSourceTables(branch: DatabaseNode[]): TableNode[] {
  const selected: TableNode[] = [];
  for (const db of branch) {
    for (const schema of db.schemas) {
      for (const table of schema.tables) {
        if (table.isSelected) {
          selected.push({ ...table });
        }
      }
    }
  }
  return selected;
}

export function collectSelectedSourceQualifiedNames(branch: DatabaseNode[]): string[] {
  return flattenSelectedSourceTables(branch).map((table) => table.qualifiedName);
}

export function getSelectedSourceTables(branch: DatabaseNode[]): TableNode[] {
  return flattenSelectedSourceTables(branch);
}

export function getSelectedTargetTable(branch: DatabaseNode[]): TableNode | undefined {
  for (const db of branch) {
    for (const schema of db.schemas) {
      for (const table of schema.tables) {
        if (table.isSelected) {
          return table;
        }
      }
    }
  }
  return undefined;
}

function mergeSelectedTables(...groups: TableNode[][]): TableNode[] {
  const merged = new Map<string, TableNode>();
  for (const group of groups) {
    for (const table of group) {
      if (!table.isSelected) continue;
      const key = table.qualifiedName.toUpperCase();
      const current = merged.get(key);
      merged.set(key, {
        ...current,
        ...table,
        columnItems:
          table.columnItems?.length ? table.columnItems : current?.columnItems,
        columns: table.columns || current?.columns || 0,
        isSelected: true,
      });
    }
  }
  return [...merged.values()];
}

/**
 * Resolve selection from both representations used by the builder. Saved/imported
 * mappings hydrate the flat list before their schema tree is loaded, while live
 * browsing populates the tree first. Both are authoritative for selected items.
 */
export function resolveSelectedSourceTables(state: {
  sourceDatabases: DatabaseNode[];
  sources: TableNode[];
}): TableNode[] {
  return mergeSelectedTables(
    state.sources.filter((table) => table.isSelected),
    getSelectedSourceTables(state.sourceDatabases),
  );
}

export function resolveSelectedTargetTable(state: {
  targetDatabases: DatabaseNode[];
  targets: TableNode[];
}): TableNode | undefined {
  return (
    getSelectedTargetTable(state.targetDatabases) ??
    state.targets.find((table) => table.isSelected)
  );
}

export function resolveBuilderSelectionState(state: {
  sourceDatabases: DatabaseNode[];
  targetDatabases: DatabaseNode[];
  sources: TableNode[];
  targets: TableNode[];
  derivedSources: DerivedSource[];
}) {
  const resolvedSourceTables = resolveSelectedSourceTables(state);
  const selectedTargetTable = resolveSelectedTargetTable(state);

  const canProceedToMapping =
    (resolvedSourceTables.length > 0 ||
      state.derivedSources.some((source) => source.isSelected)) &&
    Boolean(selectedTargetTable);

  return {
    resolvedSourceTables,
    selectedTargetTable,
    canProceedToMapping,
  };
}
