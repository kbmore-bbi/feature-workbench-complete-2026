'use client';
import { AiaBox, AiaCollapse } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';

import { useMemo, useState, type ReactNode } from 'react';
import {
  KeyboardArrowDownRoundedIcon,
  KeyboardArrowRightRoundedIcon,
} from '@/utils/icons';

import type { Column, ColumnGroup, DatabaseNode } from '@/features/sttm/types/sttm.types';
import { HierarchyIcon } from '@/features/sttm/shared/hierarchy-icons';
import {
  buildSelectedSourceHierarchy,
  filterSourceHierarchy,
} from '@/features/sttm/shared/source-hierarchy-utils';
import {
  formatSqlType,
  getColumnSampleDisplayValue,
} from '@/features/sttm/mapping/mapping-utils';
import {
  sttmSidebarBodyTextMutedSx,
  sttmSidebarBodyTextSx,
  sttmSidebarChevronSx,
  sttmSidebarColumnMetaSx,
  sttmSidebarColumnNameSx,
  sttmSidebarColumnTypeSx,
  sttmSidebarHierarchyIconSx,
  sttmSidebarSecondaryTextSx,
} from '@/features/sttm/layout/sttm-sidebar-text-styles';

function AttributeColumnRow({
  column,
  highlighted = false,
  meta,
  showMeta = true,
}: {
  column: Column;
  highlighted?: boolean;
  meta?: ReactNode;
  showMeta?: boolean;
}) {
  const typeLabel = (column.type ? formatSqlType(column.type) : '—').toLowerCase();
  const sampleValue = showMeta ? (meta ?? getColumnSampleDisplayValue(column.name, column.type)) : null;

  return (
    <AiaBox
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 1,
        pl: 6.5,
        pr: 1,
        py: 0.45,
        borderRadius: '6px',
        color: 'var(--color-text)',
      }}
    >
      <AiaBox sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0, flex: 1 }}>
        <HierarchyIcon level="column" sx={sttmSidebarHierarchyIconSx} />
        <AiaBox sx={{ minWidth: 0 }}>
          <AiaText
            sx={{
              ...sttmSidebarColumnNameSx,
              whiteSpace: 'normal',
              overflow: 'visible',
              textOverflow: 'clip',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
              ...(highlighted ? { fontWeight: 600 } : {}),
            }}
          >
            {column.name}
          </AiaText>
          <AiaText sx={sttmSidebarColumnTypeSx}>{typeLabel}</AiaText>
        </AiaBox>
      </AiaBox>
      {sampleValue != null &&
        (typeof sampleValue === 'string' ? (
          <AiaText sx={sttmSidebarColumnMetaSx}>{sampleValue}</AiaText>
        ) : (
          sampleValue
        ))}
    </AiaBox>
  );
}

type SelectedSourceHierarchyTreeProps = {
  databases?: DatabaseNode[];
  attributeGroups?: ColumnGroup[];
  searchText?: string;
  isColumnHighlighted?: (column: Column) => boolean;
  renderColumnMeta?: (column: Column) => ReactNode;
  showColumnMeta?: boolean;
};

export function SelectedSourceHierarchyTree({
  databases = [],
  attributeGroups = [],
  searchText = '',
  isColumnHighlighted,
  renderColumnMeta,
  showColumnMeta = true,
}: SelectedSourceHierarchyTreeProps) {
  const hierarchy = useMemo(
    () => buildSelectedSourceHierarchy(databases, attributeGroups),
    [databases, attributeGroups],
  );

  const filteredHierarchy = useMemo(
    () => filterSourceHierarchy(hierarchy, searchText),
    [hierarchy, searchText],
  );

  const [expandedDbs, setExpandedDbs] = useState<Record<string, boolean>>({});
  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  const toggleRecord = (
    setter: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
    key: string,
    defaultValue = true,
  ) => {
    setter((current) => ({
      ...current,
      [key]: !(current[key] ?? defaultValue),
    }));
  };

  if (!hierarchy.length) {
    return null;
  }

  if (!filteredHierarchy.length && searchText.trim()) {
    return (
      <AiaText sx={{ ...sttmSidebarBodyTextMutedSx, px: 1, py: 0.5 }}>
        No columns match your search.
      </AiaText>
    );
  }

  if (!filteredHierarchy.length) {
    return null;
  }

  return (
    <AiaBox sx={{ py: 0.5 }}>
      {filteredHierarchy.map((db) => {
        const dbKey = db.dbId;
        const dbExpanded = expandedDbs[dbKey] ?? true;

        return (
          <AiaBox key={dbKey} sx={{ mb: 0.4 }}>
            <AiaBox
              onClick={() => toggleRecord(setExpandedDbs, dbKey)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.6,
                borderRadius: '6px',
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'var(--color-surface-muted)' },
              }}
            >
              {dbExpanded ? (
                <KeyboardArrowDownRoundedIcon sx={sttmSidebarChevronSx} />
              ) : (
                <KeyboardArrowRightRoundedIcon sx={sttmSidebarChevronSx} />
              )}
              <HierarchyIcon level="database" sx={sttmSidebarHierarchyIconSx} />
              <AiaText
                sx={{
                  ...sttmSidebarBodyTextSx,
                  flex: 1,
                  fontWeight: 400,
                  minWidth: 0,
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                }}
              >
                {db.dbName}
              </AiaText>
            </AiaBox>

            <AiaCollapse in={dbExpanded} timeout="auto" unmountOnExit>
              <AiaBox sx={{ mt: 0.2 }}>
                {db.schemas.map((schema) => {
                  const schemaKey = `${dbKey}:${schema.schemaId}`;
                  const schemaExpanded = expandedSchemas[schemaKey] ?? true;

                  return (
                    <AiaBox key={schemaKey}>
                      <AiaBox
                        onClick={() => toggleRecord(setExpandedSchemas, schemaKey)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          pl: 3,
                          pr: 1,
                          py: 0.5,
                          borderRadius: '6px',
                          cursor: 'pointer',
                          '&:hover': { backgroundColor: 'var(--color-surface-muted)' },
                        }}
                      >
                        <HierarchyIcon level="schema" sx={sttmSidebarHierarchyIconSx} />
                        <AiaText
                          sx={{
                            ...sttmSidebarBodyTextSx,
                            flex: 1,
                            fontWeight: 400,
                            minWidth: 0,
                            whiteSpace: 'normal',
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word',
                          }}
                        >
                          {schema.schemaName}
                        </AiaText>
                        {schemaExpanded ? (
                          <KeyboardArrowDownRoundedIcon sx={sttmSidebarChevronSx} />
                        ) : (
                          <KeyboardArrowRightRoundedIcon sx={sttmSidebarChevronSx} />
                        )}
                      </AiaBox>

                      <AiaCollapse in={schemaExpanded} timeout="auto" unmountOnExit>
                        <AiaBox sx={{ mt: 0.2 }}>
                          {schema.tables.map((table) => {
                            const tableKey = table.qualifiedName;
                            const tableExpanded = expandedTables[tableKey] ?? true;

                            return (
                              <AiaBox key={tableKey}>
                                <AiaBox
                                  onClick={() => toggleRecord(setExpandedTables, tableKey)}
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    pl: 5,
                                    pr: 1,
                                    py: 0.45,
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    '&:hover': { backgroundColor: 'var(--color-surface-muted)' },
                                  }}
                                >
                                  <HierarchyIcon level="table" sx={sttmSidebarHierarchyIconSx} />
                                  <AiaText
                                    sx={{
                                      ...sttmSidebarBodyTextSx,
                                      flex: 1,
                                      minWidth: 0,
                                      whiteSpace: 'normal',
                                      overflowWrap: 'anywhere',
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {table.tableName}
                                  </AiaText>
                                  <AiaText sx={{ ...sttmSidebarSecondaryTextSx, flexShrink: 0 }}>
                                    {table.columns.length} cols
                                  </AiaText>
                                  {tableExpanded ? (
                                    <KeyboardArrowDownRoundedIcon sx={sttmSidebarChevronSx} />
                                  ) : (
                                    <KeyboardArrowRightRoundedIcon sx={sttmSidebarChevronSx} />
                                  )}
                                </AiaBox>

                                <AiaCollapse in={tableExpanded} timeout="auto" unmountOnExit>
                                  {table.columns.length ? (
                                    table.columns.map((column) => (
                                      <AttributeColumnRow
                                        key={`${tableKey}:${column.name}`}
                                        column={column}
                                        highlighted={isColumnHighlighted?.(column) ?? false}
                                        meta={renderColumnMeta?.(column)}
                                        showMeta={showColumnMeta}
                                      />
                                    ))
                                  ) : (
                                    <AiaText
                                      sx={{
                                        ...sttmSidebarBodyTextMutedSx,
                                        pl: 5,
                                        pr: 1,
                                        py: 0.5,
                                      }}
                                    >
                                      No columns loaded
                                    </AiaText>
                                  )}
                                </AiaCollapse>
                              </AiaBox>
                            );
                          })}
                        </AiaBox>
                      </AiaCollapse>
                    </AiaBox>
                  );
                })}
              </AiaBox>
            </AiaCollapse>
          </AiaBox>
        );
      })}
    </AiaBox>
  );
}
