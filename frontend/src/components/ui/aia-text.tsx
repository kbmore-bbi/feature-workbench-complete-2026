'use client';

import React from 'react';
import { Typography, type TypographyProps } from '@mui/material';

export type AiaTextVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'subtitle1'
  | 'subtitle2'
  | 'body1'
  | 'body2'
  | 'button'
  | 'caption'
  | 'overline';

export interface AiaTextProps extends TypographyProps {
  variant?: AiaTextVariant;
}

export function AiaText({ variant = 'body1', children, ...props }: AiaTextProps) {
  return (
    <Typography variant={variant} {...props}>
      {children}
    </Typography>
  );
}

export default AiaText;
