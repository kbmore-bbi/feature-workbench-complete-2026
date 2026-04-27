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

interface Option {
    label: string;
    value: string;
}

interface FocusSelectProps {
    label?: string;
    value?: string | string[];
    options?: Option[];
    onChange?: (value: string | string[]) => void;

    multiple?: boolean;
    disabled?: boolean;
    size?: 'small' | 'medium';
    fullWidth?: boolean;
}

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;

const MenuProps = {
    slotProps: {
        paper: {
            sx: {
                maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
            },
        },
    },
};

const FocusSelect = ({
    label = '',
    value,
    options = [],
    onChange,
    multiple = false,
    disabled = false,
    size = 'small',
    fullWidth = true,
}: FocusSelectProps) => {
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
        <FormControl sx={{ m: 1, minWidth: 120 }} size={size} fullWidth={fullWidth}
            disabled={disabled}>
            {label && <InputLabel size={size}>{label}</InputLabel>}
            <Select
                multiple={multiple}
                value={value}
                label={label}
                onChange={handleChange}
                input={<OutlinedInput label={label} size={size} />}
                MenuProps={MenuProps}
                sx={{
                    '& .MuiSelect-select': {
                        paddingTop: size === 'small' ? 1.5 : 2,
                        paddingBottom: size === 'small' ? 1.5 : 2,
                    },
                }}
                renderValue={(selected) =>
                    multiple
                        ? (selected as string[])
                            .map(v => options.find(o => o.value === v)?.label)
                            .join(', ')
                        : options.find(o => o.value === selected)?.label
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

export { FocusSelect };
