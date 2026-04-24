'use client';
import { createContext, useContext, useState } from 'react';
import { DB_SCHEMA_TABLE_SELECTION } from '@/data/source';

const SttmBuilderContext = createContext<any>({});

export function SttmBuilderProvider({ children }: any) {
  const [fullData, setFullData] = useState(DB_SCHEMA_TABLE_SELECTION);
  const [sources, setSources] = useState<any[]>([]);
  const [targets, setTargets] = useState<any[]>([]);
  const [sourceInfo, setSourceInfo] = useState({ dbName: '', schemaName: '' });
  const [targetInfo, setTargetInfo] = useState({ dbName: '', schemaName: '' });

  // ✅ HIERARCHY ENGINE: Recalculates selection for parents
  const syncHierarchy = (branch: any[]) => {
    return branch.map((db: any) => {
      const updatedSchemas = db.schemas.map((sch: any) => {
        const hasSelectedTable = sch.tables.some((t: any) => t.isSelected);
        return { ...sch, isSelected: hasSelectedTable };
      });
      const hasSelectedSchema = updatedSchemas.some((s: any) => s.isSelected);
      return { ...db, schemas: updatedSchemas, isSelected: hasSelectedSchema };
    });
  };

  /* ---------- HANDLERS ---------- */

  const selectSchema = (type: 'source' | 'target', dbId: string, schemaId: string) => {
    const branch = type === 'source' ? fullData.sources : fullData.targets;
    const database = branch.find((db: any) => db.dbId === dbId);
    const schema = database?.schemas.find((sch: any) => sch.schemaId === schemaId);

    if (schema && database) {
      if (type === 'source') {
        setSources(schema.tables);
        setSourceInfo({ dbName: database.dbName, schemaName: schema.schemaName });
      } else {
        setTargets(schema.tables);
        setTargetInfo({ dbName: database.dbName, schemaName: schema.schemaName });
      }
    }
  };

  const toggleSource = (tableId: string) => {
    setFullData((prev: any) => {
      const updated = prev.sources.map((db: any) => ({
        ...db,
        schemas: db.schemas.map((sch: any) => ({
          ...sch,
          tables: sch.tables.map((t: any) =>
            t.tableId === tableId ? { ...t, isSelected: !t.isSelected } : t
          )
        }))
      }));
      return { ...prev, sources: syncHierarchy(updated) };
    });
    setSources(prev => prev.map(t => t.tableId === tableId ? { ...t, isSelected: !t.isSelected } : t));
  };

  const selectTarget = (tableId: string) => {
    setFullData((prev: any) => {
      const updated = prev.targets.map((db: any) => ({
        ...db,
        schemas: db.schemas.map((sch: any) => ({
          ...sch,
          tables: sch.tables.map((t: any) => ({
            ...t,
            isSelected: t.tableId === tableId
          }))
        }))
      }));
      return { ...prev, targets: syncHierarchy(updated) };
    });
    setTargets(prev => prev.map(t => ({ ...t, isSelected: t.tableId === tableId })));
  };

  /* ---------- CLEAR SOURCE LOGIC ---------- */
  // const clearSources = () => {
  //   // 1. Reset Global Hierarchy for Sources
  //   setFullData((prev: any) => ({
  //     ...prev,
  //     sources: prev.sources.map((db: any) => ({
  //       ...db,
  //       isSelected: false,
  //       schemas: db.schemas.map((sch: any) => ({
  //         ...sch,
  //         isSelected: false,
  //         tables: sch.tables.map((tbl: any) => ({ ...tbl, isSelected: false }))
  //       }))
  //     }))
  //   }));

  //   // 2. Reset Visible Middle Panel (UI)
  //   setSources((prev: any) => prev.map((item: any) => ({ ...item, isSelected: false })));
  // };

    /* ---------- CLEAR SOURCE (Current Schema Only) ---------- */
  const clearSources = () => {
    // 1. Get IDs of tables currently visible in the middle panel
    const activeTableIds = sources.map((t: any) => t.tableId);

    // 2. Update Global Master State: Clear only those IDs
    setFullData((prev: any) => {
      const updatedSources = prev.sources.map((db: any) => ({
        ...db,
        schemas: db.schemas.map((sch: any) => ({
          ...sch,
          tables: sch.tables.map((tbl: any) => 
            activeTableIds.includes(tbl.tableId) 
              ? { ...tbl, isSelected: false } 
              : tbl
          )
        }))
      }));

      // Re-run the hierarchy sync to update Sidebar Checkboxes for those parents
      return { ...prev, sources: syncHierarchy(updatedSources) };
    });

    // 3. Update Visible Middle Panel (UI)
    setSources((prev: any) => prev.map((item: any) => ({ ...item, isSelected: false })));
  };


  /* ---------- CLEAR TARGET LOGIC ---------- */
  const clearTargets = () => {
    // 1. Reset Global Hierarchy for Targets
    setFullData((prev: any) => ({
      ...prev,
      targets: prev.targets.map((db: any) => ({
        ...db,
        isSelected: false,
        schemas: db.schemas.map((sch: any) => ({
          ...sch,
          isSelected: false,
          tables: sch.tables.map((tbl: any) => ({ ...tbl, isSelected: false }))
        }))
      }))
    }));

    // 2. Reset Visible Middle Panel (UI)
    setTargets((prev: any) => prev.map((item: any) => ({ ...item, isSelected: false })));
  };


  return (
    <SttmBuilderContext.Provider value={{
      fullData, sources, targets, sourceInfo, targetInfo,
      toggleSource, selectTarget, selectSchema, clearTargets, clearSources
    }}>
      {children}
    </SttmBuilderContext.Provider>
  );
}

export const useSttmBuilderContext = () => useContext(SttmBuilderContext);
