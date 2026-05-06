'use client';

import React from 'react';
import { Button } from '@mui/material';

interface FocusButtonProps {
    children?: React.ReactNode;
    className?: string;

    onClick?: () => void;
    disabled?: boolean;

    startIcon?: React.ReactNode;
    endIcon?: React.ReactNode;

    variant?: 'text' | 'contained' | 'outlined';
    size?: 'small' | 'medium' | 'large';

    rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
    color?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';

    customColor?: string;
    customBackgroundColor?: string;
    customHoverBackgroundColor?: string;
    customBorderColor?: string;
}

const radiusMap = {
    none: 0,
    sm: '4px',
    md: '8px',
    lg: '12px',
    full: '999px',
};

const FocusButton = ({
    children,
    className,
    onClick,
    disabled = false,
    startIcon,
    endIcon,
    variant = 'contained',
    size = 'large',
    rounded = 'md',
    color = 'primary',
    customColor,
    customBackgroundColor,
    customHoverBackgroundColor,
    customBorderColor
}: FocusButtonProps) => {

    const isIconOnly = !children;

    return (
        <Button
            className={className}
            color={color}
            variant={variant}
            size={size}
            onClick={onClick}
            disabled={disabled}
            startIcon={startIcon}
            endIcon={endIcon}
            sx={{
                textTransform: 'none',
                borderRadius: radiusMap[rounded],
                minWidth: isIconOnly ? 36 : undefined,
                padding: isIconOnly ? '8px' : undefined,
                color: customColor ? customColor : undefined,
                borderColor: customBorderColor ? customBorderColor : undefined,
                backgroundColor: customBackgroundColor ? customBackgroundColor : undefined,
                "&:hover": {
                    color: customColor ?? undefined,
                    borderColor: customBorderColor ?? undefined,
                    backgroundColor:
                        customHoverBackgroundColor ??
                        customBackgroundColor ??
                        undefined,
                },
            }}>
            {children}
        </Button>
    );
}

export { FocusButton }