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

interface Option {
    label: string;
    value: string;
}

interface AiaSelectProps {
    label?: string;
    value?: string | string[];
    options?: Option[];
    onChange?: (value: string | string[]) => void;
    placeholder?: string;

    multiple?: boolean;
    disabled?: boolean;
    size?: 'small' | 'medium';
    fullWidth?: boolean;
    /** Merged into the root FormControl for layout/density overrides from parents. */
    sx?: SxProps<Theme>;
}

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;

const MenuProps = {
    slotProps: {
        paper: {
            sx: {
                // show up to 4 items, then scroll
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
    sx,
}: AiaSelectProps) => {
    const handleChange = (
        event: SelectChangeEvent<string | string[]>,
        _child: React.ReactNode
    ) => {
        const rawValue = event.target.value;
        onChange?.(
            multiple
                ? typeof rawValue === 'string'
                    ? rawValue.split(',')
                    : (rawValue as string[])
                : (rawValue as string)
        );
    };

    return (
        <FormControl
            sx={[
                { minWidth: fullWidth ? 0 : 120 },
                ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
            ]}
            size={size}
            fullWidth={fullWidth}
            disabled={disabled}
        >
            {label && <InputLabel size={size}>{label}</InputLabel>}
            <Select
                multiple={multiple}
                value={value}
                label={label}
                onChange={handleChange}
                input={<OutlinedInput label={label} size={size} />}
                MenuProps={MenuProps}
                displayEmpty
                sx={{
                    '& .MuiSelect-select': {
                        paddingTop: size === 'small' ? 1 : 1.5,
                        paddingBottom: size === 'small' ? 1 : 1.5,
                    },
                }}
                renderValue={(selected) =>
                    multiple
                        ? (selected as string[])
                            .map(v => options.find(o => o.value === v)?.label)
                            .join(', ')
                        : (() => {
                            const s = selected as string;
                            if (!s) return (
                                <span style={{ color: '#9ca3af' }}>
                                    {placeholder}
                                </span>
                            );
                            return options.find(o => o.value === s)?.label ?? (
                                <span style={{ color: '#9ca3af' }}>
                                    {placeholder}
                                </span>
                            );
                        })()
                }>
                {options.map((opt) => {
                    const isSelected = multiple
                        ? (value as string[]).includes(opt.value)
                        : value === opt.value;

                    return (
                        <MenuItem key={opt.value} value={opt.value}>
                            {multiple && <Checkbox checked={isSelected} size="medium" />}
                            <ListItemText primary={opt.label} />
                        </MenuItem>
                    );
                })}
            </Select>
        </FormControl>
    );
};

export { AiaSelect };
