'use client';

import React from 'react';
import {
    Autocomplete,
    TextField,
} from '@mui/material';

interface Option {
    label: string;
    value: string;
}

interface FocusAutocompleteProps {
    label?: string;
    value?: string | string[];
    options?: Option[];
    onChange?: (value: string | string[]) => void;

    multiple?: boolean;
    size?: 'small' | 'medium';
    disabled?: boolean;
    fullWidth?: boolean;
}

const FocusAutocomplete = ({
    label = '',
    value,
    options = [],
    onChange,
    multiple = false,
    size = 'small',
    disabled = false,
    fullWidth = true,
}: FocusAutocompleteProps) => {

    const resolvedValue = multiple
        ? options.filter(o => (value as string[])?.includes(o.value))
        : options.find(o => o.value === value) ?? null;


    const handleChange = (
        _event: React.SyntheticEvent,
        newValue: Option | Option[] | null
    ) => {
        if (multiple) {
            onChange?.(
                Array.isArray(newValue)
                    ? newValue.map(v => v.value)
                    : []
            );
        } else {
            onChange?.((newValue as Option | null)?.value ?? '');
        }
    };


    return (
        <Autocomplete
            multiple={multiple}
            options={options}
            value={resolvedValue}
            size={size}
            disabled={disabled}
            fullWidth={fullWidth}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, val) => option.value === val.value}
            onChange={handleChange}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label={label}
                    size={size}

                    sx={{
                        '& .MuiAutocomplete-input': {
                            paddingTop: size === 'small' ? 10 : 16,
                            paddingBottom: size === 'small' ? 10 : 16,
                        },
                    }}

                />
            )}
        />
    );
};

export { FocusAutocomplete };
