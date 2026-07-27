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

  // Saved/draft mappings restore selected tables and their attribute groups
  // without eagerly reopening every catalog database/schema branch. A fresh
  // database lookup therefore often has empty `schemas`, even though the
  // workspace has valid selected columns. Merge those persisted groups into
  // the display hierarchy so reopening a mapping does not depend on browsing
  // Step 1 again.
  for (const group of attributeGroups) {
    const qualifiedName = String(group.qualifiedName || '').trim();
    const parts = qualifiedName.split('.').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) {
      continue;
    }
    const databaseName = parts[0];
    const schemaName = parts.slice(1, -1).join('.');
    const tableName = String(group.table || parts[parts.length - 1]).trim();
    const databaseKey = databaseName.toUpperCase();
    const schemaKey = schemaName.toUpperCase();
    const tableKey = qualifiedName.toUpperCase();

    let database = hierarchy.find(
      (item) => item.dbId.toUpperCase() === databaseKey || item.dbName.toUpperCase() === databaseKey,
    );
    if (!database) {
      database = {
        dbId: databaseName,
        dbName: databaseName,
        schemas: [],
      };
      hierarchy.push(database);
    }

    let schema = database.schemas.find(
      (item) =>
        item.schemaName.toUpperCase() === schemaKey ||
        item.schemaId.toUpperCase() === `${databaseKey}:${schemaKey}`,
    );
    if (!schema) {
      schema = {
        schemaId: `${databaseName}:${schemaName}`,
        schemaName,
        tables: [],
      };
      database.schemas.push(schema);
    }

    const existingTable = schema.tables.find(
      (item) => item.qualifiedName.toUpperCase() === tableKey,
    );
    if (existingTable) {
      existingTable.columns = group.columns;
      continue;
    }
    schema.tables.push({
      tableId: qualifiedName,
      tableName,
      qualifiedName,
      columns: group.columns,
    });
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
