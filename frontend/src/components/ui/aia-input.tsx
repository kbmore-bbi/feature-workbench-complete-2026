'use client';

import React from 'react';
import { FormControl, InputBase, TextField } from '@mui/material';
import type { TextFieldVariants } from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';

interface AiaInputProps {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  disabled?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  multiline?: boolean;
  minRows?: number;
  maxRows?: number;
  rows?: number;
  variant?: TextFieldVariants;
  /** Borderless input for chat bars and inline filters. */
  appearance?: 'outlined' | 'bare';
  onKeyDown?: (event: React.KeyboardEvent) => void;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  sx?: SxProps<Theme>;
}

const AiaInput = ({
  label = '',
  value,
  onChange,
  type = 'text',
  placeholder = '',
  disabled = false,
  size = 'small',
  fullWidth = true,
  multiline = false,
  minRows,
  maxRows,
  rows,
  variant = 'outlined',
  appearance = 'outlined',
  onKeyDown,
  inputProps,
  sx,
}: AiaInputProps) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange?.(event.target.value);
  };

  const htmlInputProps = {
    autoComplete: 'off',
    ...inputProps,
  };

  if (appearance === 'bare') {
    return (
      <InputBase
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        fullWidth={fullWidth}
        inputProps={htmlInputProps}
        sx={sx}
      />
    );
  }

  return (
    <FormControl fullWidth={fullWidth} disabled={disabled} size={size}>
      <TextField
        label={label || undefined}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        type={type}
        placeholder={placeholder}
        size={size}
        variant={variant}
        fullWidth={fullWidth}
        disabled={disabled}
        multiline={multiline}
        minRows={multiline ? (minRows ?? rows ?? 1) : undefined}
        maxRows={multiline ? maxRows : undefined}
        autoComplete="off"
        slotProps={{ htmlInput: htmlInputProps }}
        sx={[
          {
            '& .MuiInputBase-input': {
              paddingY: size === 'small' ? 1.5 : 2,
            },
          },
          ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
        ]}
      />
    </FormControl>
  );
};

export { AiaInput };
