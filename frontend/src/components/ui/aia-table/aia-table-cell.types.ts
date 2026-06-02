import type { SxProps, Theme } from '@mui/material/styles';

export type AiaTableCellProps = {
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  minWidth?: number | string;
  padding?: 'checkbox' | 'none' | 'normal';
  sx?: SxProps<Theme>;
};

export function aiaTableCellSx(
  props: AiaTableCellProps = {},
  extra?: SxProps<Theme>,
): SxProps<Theme> {
  return [
    props.width !== undefined ? { width: props.width } : {},
    props.minWidth !== undefined ? { minWidth: props.minWidth } : {},
    ...(extra ? (Array.isArray(extra) ? extra : [extra]) : []),
    ...(props.sx ? (Array.isArray(props.sx) ? props.sx : [props.sx]) : []),
  ];
}
