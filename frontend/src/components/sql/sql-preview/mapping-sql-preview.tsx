'use client';

import type { ReactNode } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import { Box, Button, Paper } from '@mui/material';
import { SqlPreviewHeader } from './sql-preview-header';
import { SqlPreviewMetaBox } from './sql-preview-meta-box';
import { SqlPreviewSection } from './sql-preview-section';
import { SqlPreviewSqlBlock } from './sql-preview-sql-block';
import { SQL_PREVIEW_WORKSPACE_BG } from './sql-preview-styles';

export type MappingSqlPreviewProps = {
  targetLabel?: string | null;
  mappedCount: number;
  tableCount: number;
  filterCount: number;
  joinCount: number;
  sourceQuerySql: string;
  generatedSql: string;
  onCopyGeneratedSql?: () => void | Promise<void>;
  onValidate?: () => void;
  validateDisabled?: boolean;
  validateLoading?: boolean;
  validateLabel?: string;
  onRunPreview?: () => void;
  runDisabled?: boolean;
  runLoading?: boolean;
  runLabel?: string;
  readOnly?: boolean;
  statusPanel?: ReactNode;
};

export function MappingSqlPreview({
  targetLabel,
  mappedCount,
  tableCount,
  filterCount,
  joinCount,
  sourceQuerySql,
  generatedSql,
  onCopyGeneratedSql,
  onValidate,
  validateDisabled,
  validateLoading = false,
  validateLabel = 'Validate SQL',
  onRunPreview,
  runDisabled = true,
  runLoading = false,
  runLabel = 'Run Preview',
  readOnly = false,
  statusPanel,
}: MappingSqlPreviewProps) {
  return (
    <Box
      sx={{
        flex: 1,
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        backgroundColor: SQL_PREVIEW_WORKSPACE_BG,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Paper
        elevation={0}
        sx={{
          height: '100%',
          borderRadius: 0,
          backgroundColor: SQL_PREVIEW_WORKSPACE_BG,
          color: '#e2e8f0',
          border: 'none',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <SqlPreviewHeader
          title="Generated SQL"
          subtitle={targetLabel ?? undefined}
          stats={[
            { id: 'mapped', label: `${mappedCount} MAPPED` },
            { id: 'tables', label: `${tableCount} TABLES` },
            { id: 'filters', label: `${filterCount} FILTERS` },
          ]}
          copyValue={generatedSql}
          onCopy={onCopyGeneratedSql}
          actions={
            !readOnly ? (
              <>
                <Button
                  variant="contained"
                  size="small"
                  disabled={validateDisabled ?? mappedCount === 0}
                  onClick={onValidate}
                  startIcon={validateLoading ? <CircularProgress size={14} color="inherit" /> : undefined}
                  sx={{
                    minWidth: 118,
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 700,
                    bgcolor: '#133d5b',
                    boxShadow: 'none',
                    '&:hover': {
                      bgcolor: '#1d4f74',
                      boxShadow: 'none',
                    },
                  }}
                >
                  {validateLabel}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={runDisabled}
                  onClick={onRunPreview}
                  startIcon={runLoading ? <CircularProgress size={14} color="inherit" /> : undefined}
                  sx={{
                    minWidth: 118,
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 700,
                    borderColor: 'rgba(148,163,184,0.28)',
                    color: '#e2e8f0',
                    '&.Mui-disabled': {
                      borderColor: 'rgba(148,163,184,0.14)',
                      color: 'rgba(226,232,240,0.45)',
                    },
                  }}
                >
                  {runLabel}
                </Button>
              </>
            ) : null
          }
        />

        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2.5, py: 2.25 }}>
          {statusPanel ? (
            <Box sx={{ mb: 2 }}>
              {statusPanel}
            </Box>
          ) : null}

          <SqlPreviewSection
            title="Source query foundation"
            subtitle="Lowest-level Step 1 SQL with joins, filters, grouping, and ordering."
            badge={`${joinCount} JOINS`}
            sql={sourceQuerySql}
            emptyText="-- No source query available yet."
          />

          <SqlPreviewMetaBox
            lines={[
              'STTM Builder · Frontend-generated SQL',
              `Target: ${targetLabel ?? 'TARGET_TABLE'}`,
              'Live from source prep + mapping selections',
            ]}
          />

          <SqlPreviewSqlBlock sql={generatedSql} />
        </Box>
      </Paper>
    </Box>
  );
}
