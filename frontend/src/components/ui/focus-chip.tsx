import { Chip } from '@mui/material';

interface FocusChipProps {
  label: string;
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  rounded?: boolean; // ✅ new
}

const FocusChip = ({
  label,
  color = 'primary',
  variant = 'filled',
  size = 'medium',
  rounded = true,
}: FocusChipProps) => {
  return (
    <Chip
      label={label}
      color={color}
      variant={variant}
      size={size}
      sx={{
        borderRadius: rounded ? '999px' : '8px',
      }}
    />
  );
};

export { FocusChip };
``