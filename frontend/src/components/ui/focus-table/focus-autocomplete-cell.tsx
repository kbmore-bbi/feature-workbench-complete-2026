'use client';

import { useCallback, useMemo } from 'react';
import { Box, TableCell, Tooltip } from '@mui/material';
import { FocusAutocomplete } from '../focus-auto-complete';
import type { FocusAutocompleteOption } from '../focus-auto-complete';
import type { FocusTableCellProps } from './focus-table-cell.types';
import { focusTableCellSx } from './focus-table-cell.types';

type FocusAutocompleteCellProps = FocusTableCellProps & {
  value: string | null;
  options: FocusAutocompleteOption[];
  onChange: (value: string, matchedOption?: FocusAutocompleteOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  groupBy?: (option: FocusAutocompleteOption) => string;
  tooltipLabel?: string;
};

const AUTOCOMPLETE_INPUT_SX = {
  '& .MuiOutlinedInput-root': {
    height: 36,
    minHeight: 36,
    fontSize: '0.8rem',
    borderRadius: '6px',
    bgcolor: '#fff',
    py: '0 !important',
  },
  '& .MuiInputBase-input, & .MuiAutocomplete-input': {
    paddingY: '6px !important',
    fontSize: '0.8rem',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: '#e5e7eb',
  },
};

export const FocusAutocompleteCell = ({
  value,
  options,
  onChange,
  placeholder = 'Map source...',
  disabled = false,
  groupBy,
  tooltipLabel,
  align,
  width,
  minWidth,
  padding,
  sx,
}: FocusAutocompleteCellProps) => {
  const resolvedGroupBy = useCallback(
    (option: FocusAutocompleteOption) => groupBy?.(option) ?? option.group ?? '',
    [groupBy],
  );

  const handleChange = useCallback(
    (nextValue: string | string[]) => {
      const resolved = typeof nextValue === 'string' ? nextValue : '';
      const current = value ?? '';
      if (resolved === current) {
        return;
      }
      const matched =
        options.find(
          (option) => option.value.toLowerCase() === resolved.trim().toLowerCase(),
        ) ?? null;
      onChange(resolved, matched);
    },
    [onChange, options, value],
  );

  const memoizedOptions = useMemo(() => options, [options]);
  const trimmedValue = value?.trim() ?? '';
  const resolvedTooltip = tooltipLabel ?? trimmedValue;

  const autocomplete = (
    <FocusAutocomplete
      hideLabel
      freeSolo
      fullWidth
      size="small"
      placeholder={placeholder}
      value={value ?? ''}
      options={memoizedOptions}
      disabled={disabled}
      groupBy={resolvedGroupBy}
      onChange={handleChange}
      sx={AUTOCOMPLETE_INPUT_SX}
    />
  );

  return (
    <TableCell
      align={align}
      padding={padding}
      sx={focusTableCellSx({ width, minWidth, sx }, { overflow: 'visible' })}
    >
      {resolvedTooltip ? (
        <Tooltip
          title={resolvedTooltip}
          placement="top"
          arrow
          enterDelay={300}
          slotProps={{
            tooltip: {
              sx: {
                fontSize: '0.72rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              },
            },
          }}
        >
          <Box>{autocomplete}</Box>
        </Tooltip>
      ) : (
        autocomplete
      )}
    </TableCell>
  );
};
