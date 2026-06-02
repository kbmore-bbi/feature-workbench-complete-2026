'use client';

import { useMemo } from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { MappingState } from '@/features/sttm/types/sttm.types';
import {
  buildMappingDataPreview,
  generateMappingDescription,
  getMappingSourceColumnLabel,
  parseSourceColumns,
} from '../mapping-utils';
import { MappingDataPreviewAttributeLabel } from './mapping-data-preview-attribute-label';
import { MappingDataPreviewHeader } from './mapping-data-preview-header';
import {
  DATA_PREVIEW_BODY_CELL_SX,
  DATA_PREVIEW_HEADER_CELL_SX,
} from './mapping-data-preview-styles';
import { MappingDataPreviewValuePill } from './mapping-data-preview-value-pill';

export type MappingDataPreviewTableProps = {
  mappings: MappingState[];
  targetLabel?: string | null;
  mappedCount?: number;
};

export function MappingDataPreviewTable({
  mappings,
  targetLabel,
  mappedCount,
}: MappingDataPreviewTableProps) {
  const mappedRows = useMemo(
    () => mappings.filter((row) => row.status === 'MAPPED'),
    [mappings],
  );
  const mappingCount = mappedCount ?? mappedRows.length;

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: '#fff',
      }}
    >
      <MappingDataPreviewHeader
        targetTableName={targetLabel}
        mappedCount={mappingCount}
      />

      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          flex: 1,
          minHeight: 0,
          border: 'none',
          borderRadius: 0,
          overflow: 'auto',
        }}
      >
        <Table
          stickyHeader
          size="small"
          sx={{
            minWidth: 980,
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...DATA_PREVIEW_HEADER_CELL_SX, width: 48 }}>#</TableCell>
              <TableCell sx={{ ...DATA_PREVIEW_HEADER_CELL_SX, minWidth: 150 }}>
                Target Attr
              </TableCell>
              <TableCell sx={{ ...DATA_PREVIEW_HEADER_CELL_SX, minWidth: 170 }}>
                Source Column
              </TableCell>
              <TableCell sx={{ ...DATA_PREVIEW_HEADER_CELL_SX, minWidth: 140 }}>
                Source Value
              </TableCell>
              <TableCell sx={{ ...DATA_PREVIEW_HEADER_CELL_SX, minWidth: 160 }}>
                Transformed Value
              </TableCell>
              <TableCell sx={{ ...DATA_PREVIEW_HEADER_CELL_SX, minWidth: 280 }}>
                Description
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mappedRows.map((row, index) => {
              const preview = buildMappingDataPreview(row);
              const sourceColumn =
                getMappingSourceColumnLabel(row) ??
                parseSourceColumns(row.sourceColumn)[0] ??
                null;
              const sourceColumnName = sourceColumn
                ? sourceColumn.includes('.')
                  ? sourceColumn.split('.').slice(-1)[0]
                  : sourceColumn
                : null;
              const autoDescription = generateMappingDescription({
                rule: row.rule || 'Direct',
                sourceColumns: parseSourceColumns(row.sourceColumn),
                targetColumn: row.targetColumn,
                expression: row.expression,
              });
              const description = row.description ?? autoDescription ?? '—';

              return (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ ...DATA_PREVIEW_BODY_CELL_SX, color: '#94a3b8', fontSize: '0.78rem' }}>
                    {index + 1}
                  </TableCell>
                  <TableCell sx={DATA_PREVIEW_BODY_CELL_SX}>
                    <MappingDataPreviewAttributeLabel
                      name={row.targetColumn}
                      dataType={row.targetType}
                    />
                  </TableCell>
                  <TableCell sx={DATA_PREVIEW_BODY_CELL_SX}>
                    {sourceColumnName ? (
                      <MappingDataPreviewAttributeLabel
                        name={sourceColumnName}
                        dataType={row.sourceType ?? row.targetType}
                      />
                    ) : (
                      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8' }}>—</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={DATA_PREVIEW_BODY_CELL_SX}>
                    <MappingDataPreviewValuePill
                      value={preview.sourceValue}
                      variant="source"
                    />
                  </TableCell>
                  <TableCell sx={DATA_PREVIEW_BODY_CELL_SX}>
                    {preview.hasTransform ? (
                      <MappingDataPreviewValuePill
                        value={preview.transformedValue}
                        variant="transformed"
                        ruleLabel={preview.ruleLabel}
                      />
                    ) : (
                      <Typography sx={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600 }}>
                        --
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={DATA_PREVIEW_BODY_CELL_SX}>
                    <Typography sx={{ fontSize: '0.76rem', color: '#475569', lineHeight: 1.45 }}>
                      {description}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
            {!mappedRows.length ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 5, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.82rem', color: '#64748b' }}>
                    Map at least one target column to preview transformed sample values.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
