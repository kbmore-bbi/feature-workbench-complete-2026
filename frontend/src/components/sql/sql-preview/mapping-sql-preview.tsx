'use client';

import { useState, type ReactNode } from 'react';
import { AiaBox, AiaButton, AiaCircularProgress, AiaPaper } from '@/components/ui';

import { SqlPreviewHeader } from './sql-preview-header';
import { SqlPreviewMetaBox } from './sql-preview-meta-box';
import { SqlPreviewSection } from './sql-preview-section';
import { SqlPreviewSqlBlock } from './sql-preview-sql-block';
import { SQL_PREVIEW_WORKSPACE_BG } from './sql-preview-styles';

export type MappingSqlPreviewProps = {
  sqlTitle?: string;
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
  editableSql?: string;
  onEditableSqlChange?: (sql: string) => void;
  onReviewSqlChanges?: () => void;
  reviewSqlChangesLoading?: boolean;
};

export function MappingSqlPreview({
  sqlTitle = 'Generated SQL',
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
  editableSql,
  onEditableSqlChange,
  onReviewSqlChanges,
  reviewSqlChangesLoading = false,
}: MappingSqlPreviewProps) {
  const [editing, setEditing] = useState(false);
  return (
    <AiaBox
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
      <AiaPaper
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
          title={sqlTitle}
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
                <AiaButton
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    if (editing) {
                      onReviewSqlChanges?.();
                    } else {
                      // Imported/saved mappings already provide canonical raw
                      // SQL. Do not replace it with generated preview SQL when
                      // edit mode starts. A brand-new mapping may explicitly
                      // use the generated SQL as its initial draft.
                      if (!(editableSql ?? '').trim()) {
                        onEditableSqlChange?.(generatedSql);
                      }
                      setEditing(true);
                    }
                  }}
                  disabled={editing && (reviewSqlChangesLoading || !(editableSql ?? '').trim())}
                  customColor="#e2e8f0"
                  customBorderColor="rgba(148,163,184,0.28)"
                >
                  {editing
                    ? reviewSqlChangesLoading
                      ? 'Parsing...'
                      : 'Review Changes'
                    : 'Edit SQL'}
                </AiaButton>
                <AiaButton
                  variant="outlined"
                  size="small"
                  disabled={validateDisabled ?? mappedCount === 0}
                  onClick={onValidate}
                  startIcon={validateLoading ? <AiaCircularProgress size={14} color="inherit" /> : undefined}
                  customColor="#e2e8f0"
                  customBorderColor="rgba(148,163,184,0.28)"
                >
                  {validateLabel}
                </AiaButton>
                <AiaButton
                  variant="outlined"
                  size="small"
                  disabled={runDisabled}
                  onClick={onRunPreview}
                  startIcon={runLoading ? <AiaCircularProgress size={14} color="inherit" /> : undefined}
                  customColor="#e2e8f0"
                  customBorderColor="rgba(148,163,184,0.28)"
                >
                  {runLabel}
                </AiaButton>
              </>
            ) : null
          }
        />

        <AiaBox sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2.5, py: 2.25 }}>
          {statusPanel ? (
            <AiaBox sx={{ mb: 2 }}>
              {statusPanel}
            </AiaBox>
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

          <SqlPreviewSqlBlock
            sql={editing ? editableSql ?? generatedSql : generatedSql}
            readOnly={!editing}
            onChange={onEditableSqlChange}
          />
        </AiaBox>
      </AiaPaper>
    </AiaBox>
  );
}
