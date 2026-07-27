'use client';

import React from 'react';
import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  OutlinedInput,
  ListItemText,
  Checkbox,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AiaSelectOption {
  label: string;
  value: string;
}

export interface AiaSelectProps {
  label?: string;
  value?: string | string[];
  options?: AiaSelectOption[];
  onChange?: (value: string | string[]) => void;
  placeholder?: string;
  multiple?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  iconComponent?: React.ElementType;
  sx?: SxProps<Theme>;
}

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;

const MenuProps = {
  sx: {
    // AiaSelect is used inside custom dialogs whose overlay sits above MUI's
    // default menu z-index. Keep the portal menu above those dialogs.
    zIndex: 1600,
  },
  slotProps: {
    paper: {
      sx: {
        maxHeight: ITEM_HEIGHT * 4 + ITEM_PADDING_TOP,
      },
    },
  },
};

const AiaSelect = ({
  label = '',
  value,
  options = [],
  onChange,
  placeholder = 'Select…',
  multiple = false,
  disabled = false,
  size = 'small',
  fullWidth = true,
  iconComponent,
  sx,
}: AiaSelectProps) => {
  const handleChange = (event: SelectChangeEvent<string | string[]>) => {
    const rawValue = event.target.value;
    onChange?.(
      multiple
        ? typeof rawValue === 'string'
          ? rawValue.split(',')
          : (rawValue as string[])
        : (rawValue as string),
    );
  };

  const select = (
    <Select
      multiple={multiple}
      value={value}
      label={label || undefined}
      onChange={handleChange}
      disabled={disabled}
      IconComponent={iconComponent}
      input={label ? <OutlinedInput label={label} size={size} /> : <OutlinedInput size={size} />}
      MenuProps={MenuProps}
      displayEmpty
      sx={[
        fullWidth ? { width: '100%' } : {},
        {
          '& .MuiSelect-select': {
            paddingTop: size === 'small' ? 1 : 1.5,
            paddingBottom: size === 'small' ? 1 : 1.5,
          },
        },
        ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
      ]}
      renderValue={(selected) =>
        multiple
          ? (selected as string[])
              .map((v) => options.find((o) => o.value === v)?.label)
              .join(', ')
          : (() => {
              const s = selected as string;
              if (!s) {
                return <span style={{ color: '#9ca3af' }}>{placeholder}</span>;
              }
              return (
                options.find((o) => o.value === s)?.label ?? (
                  <span style={{ color: '#9ca3af' }}>{placeholder}</span>
                )
              );
            })()
      }
    >
      {options.map((opt) => {
        const isSelected = multiple
          ? (value as string[] | undefined)?.includes(opt.value)
          : value === opt.value;

        return (
          <MenuItem key={opt.value} value={opt.value}>
            {multiple && <Checkbox checked={!!isSelected} size="medium" />}
            <ListItemText primary={opt.label} />
          </MenuItem>
        );
      })}
    </Select>
  );

  if (!label) {
    return select;
  }

  return (
    <FormControl
      sx={[{ minWidth: fullWidth ? 0 : 120 }]}
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
    >
      <InputLabel size={size}>{label}</InputLabel>
      {select}
    </FormControl>
  );
};

export { AiaSelect };
