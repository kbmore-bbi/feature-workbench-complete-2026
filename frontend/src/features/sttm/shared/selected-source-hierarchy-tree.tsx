'use client';

import { useMemo, useState } from 'react';
import {
  KeyboardArrowDownRoundedIcon,
  KeyboardArrowRightRoundedIcon,
} from '@/utils/icons';
import { Box, Collapse, List, Typography } from '@mui/material';
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

function ExpandArrow({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16, color: 'var(--color-muted)', flexShrink: 0 }} />
  ) : (
    <KeyboardArrowRightRoundedIcon sx={{ fontSize: 16, color: 'var(--color-muted)', flexShrink: 0 }} />
  );
}

function AttributeColumnRow({ column }: { column: Column }) {
  const typeLabel = (column.type ? formatSqlType(column.type) : '—').toLowerCase();
  const sampleValue = getColumnSampleDisplayValue(column.name, column.type);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 1,
        py: 0.55,
        pl: 6.5,
        pr: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--color-text)',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {column.name}
          </Typography>
          <Typography
            sx={{
              mt: 0.15,
              fontSize: 10,
              color: 'var(--color-muted)',
              lineHeight: 1.2,
              textTransform: 'lowercase',
              letterSpacing: '0.05em',
            }}
          >
            {typeLabel}
          </Typography>
        </Box>
      </Box>
      <Typography
        sx={{
          fontSize: 10,
          color: '#94a3b8',
          lineHeight: 1.3,
          flexShrink: 0,
          maxWidth: '42%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'right',
        }}
      >
        {sampleValue}
      </Typography>
    </Box>
  );
}

type SelectedSourceHierarchyTreeProps = {
  databases?: DatabaseNode[];
  attributeGroups?: ColumnGroup[];
  searchText?: string;
};

export function SelectedSourceHierarchyTree({
  databases = [],
  attributeGroups = [],
  searchText = '',
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
      <Typography sx={{ px: 1.5, py: 1, fontSize: 11, color: 'var(--color-muted)' }}>
        No columns match your search.
      </Typography>
    );
  }

  if (!filteredHierarchy.length) {
    return null;
  }

  return (
    <List dense disablePadding sx={{ py: 0.25 }}>
      {filteredHierarchy.map((db) => {
        const dbKey = db.dbId;
        const dbExpanded = expandedDbs[dbKey] ?? true;

        return (
          <Box key={dbKey} sx={{ mb: 0.25 }}>
            <Box
              onClick={() => toggleRecord(setExpandedDbs, dbKey)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1,
                py: 0.55,
                borderRadius: '6px',
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'var(--color-surface-muted)' },
              }}
            >
              {dbExpanded ? (
                <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16, color: 'var(--color-muted)' }} />
              ) : (
                <KeyboardArrowRightRoundedIcon sx={{ fontSize: 16, color: 'var(--color-muted)' }} />
              )}
              <HierarchyIcon level="database" />
              <Typography
                sx={{
                  flex: 1,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {db.dbName}
              </Typography>
            </Box>

            <Collapse in={dbExpanded} timeout="auto" unmountOnExit>
              <Box sx={{ mt: 0.15 }}>
                {db.schemas.map((schema) => {
                  const schemaKey = `${dbKey}:${schema.schemaId}`;
                  const schemaExpanded = expandedSchemas[schemaKey] ?? true;

                  return (
                    <Box key={schemaKey}>
                      <Box
                        onClick={() => toggleRecord(setExpandedSchemas, schemaKey)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                          pl: 2.5,
                          pr: 1,
                          py: 0.45,
                          borderRadius: '6px',
                          cursor: 'pointer',
                          '&:hover': { backgroundColor: 'var(--color-surface-muted)' },
                        }}
                      >
                        <HierarchyIcon level="schema" />
                        <Typography
                          sx={{
                            flex: 1,
                            fontSize: 11.5,
                            fontWeight: 600,
                            color: 'var(--color-text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {schema.schemaName}
                        </Typography>
                        <ExpandArrow expanded={schemaExpanded} />
                      </Box>

                      <Collapse in={schemaExpanded} timeout="auto" unmountOnExit>
                        <Box sx={{ mt: 0.1 }}>
                          {schema.tables.map((table) => {
                            const tableKey = table.qualifiedName;
                            const tableExpanded = expandedTables[tableKey] ?? true;

                            return (
                              <Box key={tableKey}>
                                <Box
                                  onClick={() => toggleRecord(setExpandedTables, tableKey)}
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.75,
                                    pl: 4.5,
                                    pr: 1,
                                    py: 0.45,
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    '&:hover': { backgroundColor: 'var(--color-surface-muted)' },
                                  }}
                                >
                                  <HierarchyIcon level="table" />
                                  <Typography
                                    sx={{
                                      flex: 1,
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      color: 'var(--color-text)',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {table.tableName}
                                  </Typography>
                                  <Typography
                                    sx={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}
                                  >
                                    {table.columns.length} cols
                                  </Typography>
                                  <ExpandArrow expanded={tableExpanded} />
                                </Box>

                                <Collapse in={tableExpanded} timeout="auto" unmountOnExit>
                                  {table.columns.length ? (
                                    table.columns.map((column) => (
                                      <AttributeColumnRow
                                        key={`${tableKey}:${column.name}`}
                                        column={column}
                                      />
                                    ))
                                  ) : (
                                    <Typography
                                      sx={{
                                        pl: 6.5,
                                        pr: 1.5,
                                        py: 0.5,
                                        fontSize: 11,
                                        color: 'var(--color-muted)',
                                      }}
                                    >
                                      No columns loaded
                                    </Typography>
                                  )}
                                </Collapse>
                              </Box>
                            );
                          })}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </List>
  );
}
