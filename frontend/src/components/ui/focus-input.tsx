'use client';

import React from 'react';
import { FormControl, TextField } from '@mui/material';
import type { TextFieldVariants } from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';

interface FocusInputProps {
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

    variant?: TextFieldVariants;
    /** Merged into the TextField for layout/density overrides from parents. */
    sx?: SxProps<Theme>;
}

const FocusInput = ({
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
    variant = 'outlined',
    sx,
}: FocusInputProps) => {
    const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        onChange?.(event.target.value);
    };
    return (
        <FormControl fullWidth={fullWidth} disabled={disabled} size={size}>
            <TextField
                label={label}
                value={value}
                onChange={handleChange}
                type={type}
                placeholder={placeholder}
                size={size}
                variant={variant}
                fullWidth={fullWidth}
                disabled={disabled}
                multiline={multiline}
                minRows={multiline ? (minRows ?? 1) : undefined}
                maxRows={multiline ? maxRows : undefined}
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

export { FocusInput };