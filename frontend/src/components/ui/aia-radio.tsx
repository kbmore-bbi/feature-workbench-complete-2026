'use client';
import Radio from '@mui/material/Radio';
import type { ChangeEvent, MouseEvent } from 'react';

type AiaRadioProps = {
  checked: boolean;
  checkHandler: (checked: boolean) => void;
};

const AiaRadio = ({ checked, checkHandler }: AiaRadioProps) => {
  return (
    <Radio
      size="small"
      checked={checked}
      onChange={(event: ChangeEvent<HTMLInputElement>) => checkHandler(event.target.checked)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
      sx={{
        color: '#cbd5e1',
        '&.Mui-checked': { color: 'var(--aia-primary-bg-text-color)' },
        p: 0.5,
      }}
    />
  );
};

export { AiaRadio };
