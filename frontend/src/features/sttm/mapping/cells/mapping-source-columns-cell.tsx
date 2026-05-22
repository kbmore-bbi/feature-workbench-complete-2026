import { Box, TableCell, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { focusTableCellSx } from '@/components/ui/focus-table';
import { FocusAutocomplete } from '@/components/ui/focus-auto-complete';
import type { FocusAutocompleteOption } from '@/components/ui/focus-auto-complete';

type MappingSourceColumnsCellProps = {
  value: string | null;
  options: FocusAutocompleteOption[];
  onChange: (value: string) => void;
  width?: number | string;
  minWidth?: number | string;
  confidenceScore?: number | null;
  confidenceReason?: string | null;
  candidateSourceColumns?: string[];
  unmatchedReason?: string | null;
};

export const MappingSourceColumnsCell = ({
  value,
  options,
  onChange,
  width,
  minWidth,
  confidenceScore,
  confidenceReason,
  candidateSourceColumns = [],
  unmatchedReason,
}: MappingSourceColumnsCellProps) => {
  const helperText =
    confidenceReason ||
    unmatchedReason ||
    (candidateSourceColumns.length
      ? `Best alternatives: ${candidateSourceColumns.join(', ')}`
      : '');

  return (
    <TableCell sx={focusTableCellSx({ width, minWidth }, { overflow: 'visible' })}>
      <Box sx={{ display: 'grid', gap: 0.55 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.9,
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <FocusAutocomplete
              hideLabel
              freeSolo
              fullWidth
              size="small"
              value={value ?? ''}
              options={options}
              placeholder="Type to map source columns..."
              groupBy={(option) => option.group ?? ''}
              onChange={(next) => onChange(Array.isArray(next) ? next[0] ?? '' : next)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  minHeight: 38,
                  fontSize: '0.8rem',
                  borderRadius: '6px',
                  bgcolor: '#fff',
                },
                '& .MuiInputBase-input, & .MuiAutocomplete-input': {
                  paddingY: '7px !important',
                  fontSize: '0.8rem',
                },
              }}
            />
          </Box>

          {confidenceScore !== null && confidenceScore !== undefined ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 0.5,
                minWidth: 54,
                pt: 0.6,
                flexShrink: 0,
              }}
            >
              <Typography
                sx={{
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  color:
                    confidenceScore >= 0.8
                      ? '#166534'
                      : confidenceScore >= 0.55
                        ? '#92400e'
                        : '#b91c1c',
                }}
              >
                {Math.round(confidenceScore * 100)}%
              </Typography>

              {helperText ? (
                <Tooltip
                  title={helperText}
                  placement="top"
                  arrow
                  enterDelay={200}
                  slotProps={{
                    tooltip: {
                      sx: {
                        fontSize: '0.72rem',
                        maxWidth: 360,
                        lineHeight: 1.5,
                      },
                    },
                  }}
                >
                  <InfoOutlinedIcon sx={{ fontSize: 15, color: '#64748b', cursor: 'help' }} />
                </Tooltip>
              ) : null}
            </Box>
          ) : helperText ? (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 24, pt: 0.6, flexShrink: 0 }}>
              <Tooltip
                title={helperText}
                placement="top"
                arrow
                enterDelay={200}
                slotProps={{
                  tooltip: {
                    sx: {
                      fontSize: '0.72rem',
                      maxWidth: 360,
                      lineHeight: 1.5,
                    },
                  },
                }}
              >
                <InfoOutlinedIcon sx={{ fontSize: 15, color: '#64748b', cursor: 'help' }} />
              </Tooltip>
            </Box>
          ) : null}
        </Box>
      </Box>
    </TableCell>
  );
};
