'use client';

import Tooltip, { type TooltipProps } from '@mui/material/Tooltip';

export type AiaTooltipProps = TooltipProps;

export function AiaTooltip({
  enterDelay = 200,
  leaveDelay = 0,
  ...props
}: AiaTooltipProps) {
  return <Tooltip enterDelay={enterDelay} leaveDelay={leaveDelay} {...props} />;
}
