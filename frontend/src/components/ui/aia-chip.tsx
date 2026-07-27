import { Chip } from '@mui/material';
import type { MouseEventHandler, ReactElement } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';

const CHIP_TONE_STYLES = {
  default: { bg: '#F8FAFC', border: '#E2E8F0', text: '#475569' },
  primary: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' },
  secondary: { bg: '#F1F5F9', border: '#E2E8F0', text: '#64748B' },
  success: { bg: '#ECFDF5', border: '#BBF7D0', text: '#166534' },
  warning: { bg: '#FFF7ED', border: '#FED7AA', text: '#9A3412' },
  error: { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C' },
  info: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' },
} as const;

type AiaChipColor = keyof typeof CHIP_TONE_STYLES;

interface AiaChipProps {
  label: string;
  /** @deprecated Tonal chips always use the light-background pattern. */
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
  color?: AiaChipColor;
  /** Fully rounded pill by default. */
  rounded?: boolean;
  /** Optional leading icon; omitted by default. */
  icon?: ReactElement;
  truncateLabel?: boolean;
  customColor?: string;
  customBackgroundColor?: string;
  customBorderColor?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onDelete?: () => void;
  clickable?: boolean;
  sx?: SxProps<Theme>;
}

function resolveChipPalette(
  color: AiaChipColor,
  customBackgroundColor?: string,
  customColor?: string,
  customBorderColor?: string,
) {
  const tone = CHIP_TONE_STYLES[color] ?? CHIP_TONE_STYLES.default;

  return {
    bg: customBackgroundColor ?? tone.bg,
    border: customBorderColor ?? tone.border,
    text: customColor ?? tone.text,
  };
}

const AiaChip = ({
  label,
  color = 'default',
  size = 'small',
  rounded = true,
  icon,
  truncateLabel = false,
  customBackgroundColor,
  customColor,
  customBorderColor,
  onClick,
  onDelete,
  clickable = false,
  sx,
}: AiaChipProps) => {
  const palette = resolveChipPalette(color, customBackgroundColor, customColor, customBorderColor);
  const isInteractive = clickable || !!onClick;

  return (
    <Chip
      label={label}
      icon={icon}
      variant="outlined"
      size={size}
      clickable={isInteractive}
      onClick={onClick}
      onDelete={onDelete}
      sx={{
        borderRadius: rounded ? '999px' : '4px',
        height: size === 'small' ? 26 : 32,
        maxWidth: truncateLabel ? undefined : '100%',
        color: palette.text,
        backgroundColor: palette.bg,
        border: `1px solid ${palette.border}`,
        boxShadow: 'none',
        fontWeight: 600,
        fontSize: size === 'small' ? 11 : 12,
        cursor: isInteractive ? 'pointer' : undefined,
        '& .MuiChip-icon': {
          color: 'inherit',
          marginLeft: icon ? '8px' : 0,
          marginRight: icon ? '-2px' : 0,
          fontSize: size === 'small' ? 14 : 16,
        },
        '& .MuiChip-deleteIcon': {
          color: palette.text,
          fontSize: 16,
          '&:hover': {
            color: palette.text,
          },
        },
        '& .MuiChip-label': truncateLabel
          ? {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              px: 1.25,
            }
          : {
              display: 'block',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              overflow: 'visible',
              textOverflow: 'unset',
              lineHeight: 1.35,
              px: 1.25,
              py: 0.25,
            },
        '&:hover': isInteractive
          ? {
              backgroundColor: palette.bg,
              borderColor: palette.border,
            }
          : undefined,
        ...(sx ?? {}),
      }}
    />
  );
};

export { AiaChip, CHIP_TONE_STYLES };
export type { AiaChipProps, AiaChipColor };
