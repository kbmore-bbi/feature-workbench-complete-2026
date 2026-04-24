'use client';

import React from 'react';
import { FormControl, TextField } from '@mui/material';
import type { TextFieldVariants } from '@mui/material/TextField';

interface FocusInputProps {
    label?: string;
    value?: string;
    onChange?: (value: string) => void;

    type?: React.HTMLInputTypeAttribute;
    placeholder?: string;

    disabled?: boolean;
    size?: 'small' | 'medium';
    fullWidth?: boolean;

    variant?: TextFieldVariants;
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
    variant = 'outlined',
}: FocusInputProps) => {
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
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
                sx={{
                    '& .MuiInputBase-input': {
                        paddingY: size === 'small' ? 1.5 : 2,
                    },
                }}
            />
        </FormControl>
    );
};

export { FocusInput };