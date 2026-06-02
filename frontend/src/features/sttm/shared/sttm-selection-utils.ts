import type { DatabaseNode, TableNode } from '@/features/sttm/types/sttm.types';

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
