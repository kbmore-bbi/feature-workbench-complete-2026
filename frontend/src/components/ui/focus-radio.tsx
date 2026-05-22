'use client';
import Radio from '@mui/material/Radio';
import type { ChangeEvent, MouseEvent } from 'react';

type FocusRadioProps = {
  checked: boolean;
  checkHandler: (checked: boolean) => void;
};

const FocusRadio = ({ checked, checkHandler }: FocusRadioProps) => {
  return (
    <Radio
      size="small"
      checked={checked}
      onChange={(event: ChangeEvent<HTMLInputElement>) => checkHandler(event.target.checked)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
      sx={{
        color: '#cbd5e1',
        '&.Mui-checked': { color: '#ffffff' },
        p: 0.5,
      }}
    />
  );
};

export { FocusRadio };
