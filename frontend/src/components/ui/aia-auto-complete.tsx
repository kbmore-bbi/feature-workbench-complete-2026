'use client';

import React, { useCallback, useMemo } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { AiaChip } from './aia-chip';

export interface AiaAutocompleteOption {
  label: string;
  value: string;
  group?: string;
  dataType?: string;
}

export interface AiaAutocompleteProps {
  label?: string;
  placeholder?: string;
  hideLabel?: boolean;
  value?: string | string[];
  options?: AiaAutocompleteOption[];
  onChange?: (value: string | string[]) => void;
  multiple?: boolean;
  size?: 'small' | 'medium';
  disabled?: boolean;
  fullWidth?: boolean;
  freeSolo?: boolean;
  groupBy?: (option: AiaAutocompleteOption) => string;
  variant?: 'standard' | 'outlined' | 'filled';
  disableUnderline?: boolean;
  inputSx?: Record<string, unknown>;
  /** Merged into the root TextField for layout/density overrides from parents. */
  sx?: SxProps<Theme>;
}

function normalizeOutgoingValue(
  newValue:
    | AiaAutocompleteOption
    | AiaAutocompleteOption[]
    | (AiaAutocompleteOption | string)[]
    | string
    | null,
  multiple: boolean,
): string | string[] {
  if (multiple) {
    return Array.isArray(newValue)
      ? newValue.map((item) => (typeof item === 'string' ? item : item.value))
      : [];
  }
  if (typeof newValue === 'string') {
    return newValue;
  }
  return (newValue as AiaAutocompleteOption | null)?.value ?? '';
}

function resolveSingleValue(
  options: AiaAutocompleteOption[],
  raw: string | null | undefined,
  freeSolo: boolean,
): AiaAutocompleteOption | string | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  const match = options.find((option) => option.value === trimmed);
  if (match) {
    return match;
  }
  return freeSolo ? trimmed : null;
}

const AiaAutocomplete = ({
  label = '',
  placeholder = '',
  hideLabel = false,
  value,
  options = [],
  onChange,
  multiple = false,
  size = 'small',
  disabled = false,
  fullWidth = true,
  freeSolo = false,
  groupBy,
  variant = 'outlined',
  disableUnderline = false,
  inputSx,
  sx,
}: AiaAutocompleteProps) => {
  const currentSingleValue = multiple
    ? ''
    : typeof value === 'string'
      ? value
      : '';

  const autocompleteValue = useMemo(() => {
    if (multiple) {
      return options.filter((option) => (value as string[])?.includes(option.value));
    }
    return resolveSingleValue(options, currentSingleValue, freeSolo);
  }, [multiple, options, value, currentSingleValue, freeSolo]);

  const handleChange = useCallback(
    (
      _event: React.SyntheticEvent,
      newValue:
        | AiaAutocompleteOption
        | AiaAutocompleteOption[]
        | (AiaAutocompleteOption | string)[]
        | string
        | null,
    ) => {
      const nextValue = normalizeOutgoingValue(newValue, multiple);
      if (multiple) {
        const currentValues = Array.isArray(value) ? value : [];
        const nextValues = nextValue as string[];
        if (
          currentValues.length === nextValues.length &&
          currentValues.every((item, index) => item === nextValues[index])
        ) {
          return;
        }
        onChange?.(nextValues);
        return;
      }

      const nextString = nextValue as string;
      if (nextString === currentSingleValue) {
        return;
      }
      onChange?.(nextString);
    },
    [multiple, onChange, value, currentSingleValue],
  );

  const renderInput = useCallback(
    (params: Parameters<NonNullable<React.ComponentProps<typeof Autocomplete>['renderInput']>>[0]) => (
      <TextField
        {...params}
        label={hideLabel ? undefined : label || undefined}
        placeholder={placeholder}
        size={size}
        variant={variant}
        slotProps={{
          ...params.slotProps,
          input: {
            ...params.slotProps?.input,
            ...(disableUnderline && variant === 'standard'
              ? { disableUnderline: true }
              : {}),
            sx: inputSx,
          },
        }}
        sx={[
          hideLabel
            ? {
                '& .MuiInputLabel-root': { display: 'none' },
                '& .MuiInputBase-input, & .MuiAutocomplete-input': {
                  paddingY: size === 'small' ? 1.5 : 2,
                },
              }
            : {
                '& .MuiAutocomplete-input': {
                  paddingTop: size === 'small' ? 10 : 16,
                  paddingBottom: size === 'small' ? 10 : 16,
                },
              },
          ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
        ]}
      />
    ),
    [disableUnderline, hideLabel, inputSx, label, placeholder, size, sx, variant],
  );

  return (
    <Autocomplete
      multiple={multiple}
      freeSolo={freeSolo}
      options={options}
      value={autocompleteValue}
      size={size}
      disabled={disabled}
      fullWidth={fullWidth}
      groupBy={groupBy}
      disableCloseOnSelect={multiple}
      getOptionLabel={(option) =>
        typeof option === 'string' ? option : option.label
      }
      isOptionEqualToValue={(option, selected) => {
        if (typeof option === 'string' || typeof selected === 'string') {
          return option === selected;
        }
        return option.value === selected.value;
      }}
      onChange={handleChange}
      slotProps={{
        popper: {
          sx: { zIndex: 1600 },
        },
        paper: {
          sx: {
            fontSize: '0.8rem',
            ...(groupBy
              ? {
                  '& .MuiAutocomplete-groupLabel': {
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    color: '#9ca3af',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  },
                }
              : {}),
          },
        },
      }}
      renderTags={
        multiple
          ? (tagValue, getTagProps) =>
              tagValue.map((option, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                const label = typeof option === 'string' ? option : option.label;
                return (
                  <AiaChip
                    key={key}
                    label={label}
                    size="small"
                    color="primary"
                    onDelete={tagProps.onDelete}
                    sx={{ m: '2px' }}
                  />
                );
              })
          : undefined
      }
      renderInput={renderInput}
    />
  );
};

export { AiaAutocomplete };
