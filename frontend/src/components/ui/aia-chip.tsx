import { Chip } from '@mui/material';
import type { MouseEventHandler } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';

interface AiaChipProps {
  label: string;
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  /** `true` = pill; `false` = slight corner radius (tag chips) */
  rounded?: boolean;
  /** When true, truncate long labels with ellipsis. Default false wraps label text. */
  truncateLabel?: boolean;
  customColor?: string;
  customBackgroundColor?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onDelete?: () => void;
  sx?: SxProps<Theme>;
}

const AiaChip = ({
  label,
  color = 'primary',
  variant = 'filled',
  size = 'medium',
  rounded = true,
  truncateLabel = false,
  customBackgroundColor,
  customColor,
  onClick,
  onDelete,
  sx,
}: AiaChipProps) => {
  return (
    <Chip
      label={label}
      color={color}
      variant={variant}
      size={size}
      onClick={onClick}
      onDelete={onDelete}
      sx={{
        borderRadius: rounded ? '999px' : '4px',
        color: customColor ? customColor : undefined,
        backgroundColor: customBackgroundColor ? customBackgroundColor : undefined,
        height: truncateLabel ? undefined : 'auto',
        maxWidth: truncateLabel ? undefined : '100%',
        cursor: onClick ? 'pointer' : undefined,
        '& .MuiChip-label': truncateLabel
          ? {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }
          : {
              display: 'block',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              overflow: 'visible',
              textOverflow: 'unset',
              lineHeight: 1.35,
              py: 0.25,
            },
        ...(sx ?? {}),
      }}
    />
  );
};

export { AiaChip };
export type { AiaChipProps };
