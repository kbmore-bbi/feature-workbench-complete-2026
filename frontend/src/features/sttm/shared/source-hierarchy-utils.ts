import type { Column, ColumnGroup, DatabaseNode } from '@/features/sttm/types/sttm.types';

export type SourceHierarchyTable = {
  tableId: string;
  tableName: string;
  qualifiedName: string;
  columns: Column[];
};

export type SourceHierarchySchema = {
  schemaId: string;
  schemaName: string;
  tables: SourceHierarchyTable[];
};

export type SourceHierarchyDatabase = {
  dbId: string;
  dbName: string;
  schemas: SourceHierarchySchema[];
};

export function buildSelectedSourceHierarchy(
  databases: DatabaseNode[],
  attributeGroups: ColumnGroup[],
): SourceHierarchyDatabase[] {
  const columnsByTable = new Map(
    attributeGroups.map((group) => [group.qualifiedName, group.columns]),
  );

  const hierarchy: SourceHierarchyDatabase[] = [];

  for (const db of databases) {
    const schemas: SourceHierarchySchema[] = [];

    for (const schema of db.schemas) {
      const tables: SourceHierarchyTable[] = [];

      for (const table of schema.tables) {
        if (!table.isSelected) {
          continue;
        }

        tables.push({
          tableId: table.tableId,
          tableName: table.tableName,
          qualifiedName: table.qualifiedName,
          columns: columnsByTable.get(table.qualifiedName) ?? table.columnItems ?? [],
        });
      }

      if (tables.length) {
        schemas.push({
          schemaId: schema.schemaId,
          schemaName: schema.schemaName,
          tables,
        });
      }
    }

    if (schemas.length) {
      hierarchy.push({
        dbId: db.dbId,
        dbName: db.dbName,
        schemas,
      });
    }
  }

  return hierarchy;
}

function matchesQuery(value: string | undefined, query: string) {
  return String(value ?? '').toLowerCase().includes(query);
}

export function filterSourceHierarchy(
  hierarchy: SourceHierarchyDatabase[],
  searchText: string,
): SourceHierarchyDatabase[] {
  const query = searchText.trim().toLowerCase();
  if (!query) {
    return hierarchy;
  }

  return hierarchy
    .map((db) => {
      const dbMatch = matchesQuery(db.dbName, query);
      const schemas = db.schemas
        .map((schema) => {
          const schemaMatch = dbMatch || matchesQuery(schema.schemaName, query);
          const tables = schema.tables
            .map((table) => {
              const tableMatch = schemaMatch || matchesQuery(table.tableName, query);
              const columns = tableMatch
                ? table.columns
                : table.columns.filter(
                    (column) =>
                      matchesQuery(column.name, query) || matchesQuery(column.type, query),
                  );
              if (!tableMatch && !columns.length) {
                return null;
              }
              return {
                ...table,
                columns: tableMatch ? table.columns : columns,
              };
            })
            .filter((table): table is SourceHierarchyTable => table !== null);

          if (!schemaMatch && !tables.length) {
            return null;
          }

          return { ...schema, tables };
        })
        .filter((schema): schema is SourceHierarchySchema => schema !== null);

      if (!dbMatch && !schemas.length) {
        return null;
      }

      return { ...db, schemas };
    })
    .filter((db): db is SourceHierarchyDatabase => db !== null);
}
