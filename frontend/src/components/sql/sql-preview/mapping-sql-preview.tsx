'use client';

import { Box, Paper } from '@mui/material';
import { SqlPreviewHeader } from './sql-preview-header';
import { SqlPreviewMetaBox } from './sql-preview-meta-box';
import { SqlPreviewSection } from './sql-preview-section';
import { SqlPreviewSqlBlock } from './sql-preview-sql-block';
import { SQL_PREVIEW_WORKSPACE_BG } from './sql-preview-styles';
import { SqlValidationFooter } from './sql-validation-footer';

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
  readOnly?: boolean;
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
  readOnly = false,
}: MappingSqlPreviewProps) {
  const validationMessage =
    mappedCount > 0
      ? 'Validate the live SQL generated from source prep and mapping rules.'
      : 'Map at least one attribute to generate a validation-ready SQL statement.';

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
        />

        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2.5, py: 2.25 }}>
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

        {!readOnly ? (
          <SqlValidationFooter
            message={validationMessage}
            onValidate={onValidate}
            validateDisabled={validateDisabled ?? mappedCount === 0}
          />
        ) : null}
      </Paper>
    </Box>
  );
}
