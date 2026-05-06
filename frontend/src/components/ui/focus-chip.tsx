import { Chip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

interface FocusChipProps {
  label: string;
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  // color?: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  /** `true` = pill; `false` = slight corner radius (tag chips) */
  rounded?: boolean;
  customColor?: string;
  customBackgroundColor?: string
  onDelete?: () => void;
  sx?: SxProps<Theme>;
}

const FocusChip = ({
  label,
  color = 'primary',
  variant = 'filled',
  size = 'medium',
  rounded = true,
  customBackgroundColor,
  customColor,
  onDelete,
  sx
}: FocusChipProps) => {
  return (
    <Chip
      label={label}
      color={color}
      variant={variant}
      size={size}
      onDelete={onDelete}
      sx={{
        borderRadius: rounded ? "999px" : "4px",
        color: customColor ? customColor : undefined,
        backgroundColor: customBackgroundColor ? customBackgroundColor : undefined,
        ...(sx ?? {}),
      }}
    />
  );
};

export { FocusChip };
