'use client';

import Checkbox from '@mui/material/Checkbox';
import type { SxProps, Theme } from '@mui/material/styles';

interface AiaCheckboxProps {
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium';
  uncheckedColor?: string;
  checkedColor?: string;
  checkHandler?: (checked: boolean) => void;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>, checked: boolean) => void;
  sx?: SxProps<Theme>;
}

const AiaCheckbox = ({
  checked,
  indeterminate,
  disabled,
  size = 'small',
  uncheckedColor = 'black',
  checkedColor,
  checkHandler,
  onChange,
  sx,
}: AiaCheckboxProps) => {
  const resolvedCheckedColor = checkedColor ?? uncheckedColor;

  return (
    <Checkbox
      size={size}
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onChange={(event, isChecked) => {
        onChange?.(event, isChecked);
        checkHandler?.(isChecked);
      }}
      onClick={(event) => event.stopPropagation()}
      sx={{
        color: uncheckedColor,
        '&.Mui-checked': { color: resolvedCheckedColor },
        p: 0.5,
        ...(sx ?? {}),
      }}
    />
  );
};

export { AiaCheckbox };
