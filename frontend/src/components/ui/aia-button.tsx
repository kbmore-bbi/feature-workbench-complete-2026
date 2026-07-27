'use client';

import React from 'react';
import { Button } from '@mui/material';
import { BUTTON_SIZE_TOKENS, getButtonSizeSx, type AiaButtonSize } from '@/config/button-tokens';

interface AiaButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
    children?: React.ReactNode;
    className?: string;

    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    'aria-label'?: string;
    fullWidth?: boolean;
    sx?: import('@mui/material/styles').SxProps<import('@mui/material/styles').Theme>;

    startIcon?: React.ReactNode;
    endIcon?: React.ReactNode;

    variant?: 'text' | 'contained' | 'outlined';
    size?: AiaButtonSize;

    rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
    color?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success' | 'inherit';

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

function getStrokeColor(customColor?: string, customBorderColor?: string) {
    return customColor ?? customBorderColor;
}

function getOutlinedStyles(customColor?: string, customBorderColor?: string) {
    const strokeColor = getStrokeColor(customColor, customBorderColor);

    return {
        backgroundColor: 'transparent !important',
        opacity: 1,
        ...(strokeColor
            ? {
                color: strokeColor,
                '--aia-btn-stroke': strokeColor,
            }
            : {}),
        borderColor: 'currentColor',
        '&:hover': {
            backgroundColor: 'transparent !important',
            borderColor: 'currentColor',
        },
        '&.Mui-disabled': {
            backgroundColor: 'transparent !important',
        },
    };
}

function getDisabledStyles(strokeColor?: string) {
    return {
        opacity: 1,
        '&.Mui-disabled': {
            opacity: '0.5 !important',
            transform: 'none',
            color: strokeColor
                ? `${strokeColor} !important`
                : 'var(--aia-btn-stroke, currentColor) !important',
            borderColor: strokeColor
                ? `${strokeColor} !important`
                : 'var(--aia-btn-stroke, currentColor) !important',
            WebkitTextFillColor: 'unset',
            '& .MuiButton-endIcon, & .MuiButton-startIcon': {
                color: 'inherit',
                opacity: 1,
            },
        },
    };
}

function getConfigDrivenStyles(
    variant: AiaButtonProps['variant'],
    color: AiaButtonProps['color'],
) {
    if (variant === 'outlined') {
        return {};
    }

    if (variant === 'contained' && color === 'primary') {
        return {
            backgroundColor: 'var(--aia-button-color)',
            color: 'var(--aia-button-text-color)',
            border: '1px solid var(--aia-button-color)',
            '--aia-btn-stroke': 'var(--aia-button-text-color)',
            '&:hover': {
                backgroundColor: 'var(--aia-button-hover-color)',
                color: 'var(--aia-button-text-color)',
                borderColor: 'var(--aia-button-hover-color)',
            },
        };
    }

    if (variant === 'contained' && color === 'secondary') {
        return {
            backgroundColor: 'var(--aia-mapping-button-color)',
            color: 'var(--aia-mapping-button-text-color)',
            border: '1px solid var(--aia-mapping-button-color)',
            '--aia-btn-stroke': 'var(--aia-mapping-button-text-color)',
            '&:hover': {
                backgroundColor: 'var(--aia-mapping-button-hoverColor)',
                color: 'var(--aia-mapping-button-text-color)',
                borderColor: 'var(--aia-mapping-button-hoverColor)',
            },
        };
    }

    return {};
}

const AiaButton = ({
    children,
    className,
    onClick,
    disabled = false,
    'aria-label': ariaLabel,
    startIcon,
    endIcon,
    variant = 'contained',
    size = 'large',
    rounded = 'sm',
    color = 'primary',
    customColor,
    customBackgroundColor,
    customHoverBackgroundColor,
    customBorderColor,
    fullWidth = false,
    sx,
    ...rest
}: AiaButtonProps) => {
    const isIconOnly = !children;
    const isOutlined = variant === 'outlined';
    const strokeColor = getStrokeColor(customColor, customBorderColor);
    const hasContainedCustomColors = Boolean(
        !isOutlined &&
            (customColor || customBackgroundColor || customHoverBackgroundColor || customBorderColor),
    );
    const configStyles = getConfigDrivenStyles(variant, color);
    const outlinedStyles = isOutlined ? getOutlinedStyles(customColor, customBorderColor) : {};
    const disabledStyles = getDisabledStyles(strokeColor);
    const sizeToken = BUTTON_SIZE_TOKENS[size];

    return (
        <Button
            {...rest}
            className={className}
            color={color}
            variant={variant}
            size={size}
            onClick={onClick}
            disabled={disabled}
            aria-label={ariaLabel}
            startIcon={startIcon}
            endIcon={endIcon}
            fullWidth={fullWidth}
            sx={[
                getButtonSizeSx(size),
                {
                    textTransform: 'none',
                    borderRadius: radiusMap[rounded],
                    ...(isIconOnly
                        ? {
                            minWidth: `${sizeToken.minHeight}px`,
                            width: `${sizeToken.minHeight}px`,
                            paddingLeft: `${sizeToken.paddingTop}px`,
                            paddingRight: `${sizeToken.paddingTop}px`,
                        }
                        : {}),
                    whiteSpace: 'nowrap',
                    boxShadow: 'none',
                    ...configStyles,
                    ...outlinedStyles,
                    ...(hasContainedCustomColors
                        ? {
                            color: customColor ?? undefined,
                            borderColor: customBorderColor ?? undefined,
                            backgroundColor: customBackgroundColor ?? undefined,
                            ...(customColor ? { '--aia-btn-stroke': customColor } : {}),
                            '&:hover': {
                                color: customColor ?? undefined,
                                borderColor: customBorderColor ?? undefined,
                                backgroundColor:
                                    customHoverBackgroundColor ??
                                    customBackgroundColor ??
                                    undefined,
                            },
                        }
                        : {}),
                },
                ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
                disabledStyles,
            ]}>
            {children}
        </Button>
    );
}

export { AiaButton }
