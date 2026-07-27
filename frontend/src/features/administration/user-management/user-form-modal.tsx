'use client';

import {
  AiaBox,
  AiaButton,
  AiaDialog,
  AiaDialogActions,
  AiaDialogContent,
  AiaDialogTitle,
  AiaStack,
  AiaSwitch,
} from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { AiaInput } from '@/components/ui/aia-input';
import { AiaSelect, type AiaSelectOption } from '@/components/ui/aia-select';
import type { AdminUserRole } from '@/data/mock/administration';
import { useEffect, useMemo, useState } from 'react';
import { isValidUserProfileInput, type UserProfileInput } from '../shared/administration-utils';

const ROLE_OPTIONS: AiaSelectOption[] = [
  { value: 'Admin', label: 'Admin' },
  { value: 'Publisher', label: 'Publisher' },
  { value: 'Editor', label: 'Editor' },
  { value: 'Viewer', label: 'Viewer' },
];

const fieldLabelSx = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: '#94A3B8',
  mb: 0.75,
} as const;

const accountAccessSwitchSx = {
  '& .MuiSwitch-switchBase.Mui-checked': {
    color: 'var(--aia-button-color)',
  },
  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
    backgroundColor: 'var(--aia-button-color)',
  },
  '& .MuiSwitch-switchBase.Mui-checked:hover': {
    backgroundColor: 'color-mix(in srgb, var(--aia-button-color) 8%, transparent)',
  },
} as const;

type UserFormModalProps = {
  open: boolean;
  mode: 'create' | 'edit';
  initialValues?: UserProfileInput;
  lockEditable?: boolean;
  onClose: () => void;
  onSubmit: (input: UserProfileInput) => void;
};

const EMPTY_FORM: UserProfileInput = {
  name: '',
  email: '',
  role: 'Viewer',
  status: 'Active',
};

export default function UserFormModal({
  open,
  mode,
  initialValues,
  lockEditable = true,
  onClose,
  onSubmit,
}: UserFormModalProps) {
  const [form, setForm] = useState<UserProfileInput>(EMPTY_FORM);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(initialValues ?? EMPTY_FORM);
  }, [initialValues, open]);

  const canSubmit = useMemo(() => isValidUserProfileInput(form), [form]);
  const title = mode === 'create' ? 'Add User' : 'Edit User Profile';
  const submitLabel = mode === 'create' ? 'Create User' : 'Save Changes';
  const isUnlocked = form.status === 'Active';

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    onSubmit(form);
    onClose();
  };

  return (
    <AiaDialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <AiaDialogTitle sx={{ fontWeight: 700 }}>{title}</AiaDialogTitle>
      <AiaDialogContent>
        <AiaStack spacing={2} sx={{ pt: 1 }}>
          <AiaBox>
            <AiaText sx={fieldLabelSx}>FULL NAME</AiaText>
            <AiaInput
              fullWidth
              value={form.name}
              placeholder="Enter full name"
              onChange={(value) => setForm((current) => ({ ...current, name: value }))}
            />
          </AiaBox>
          <AiaBox>
            <AiaText sx={fieldLabelSx}>EMAIL</AiaText>
            <AiaInput
              fullWidth
              type="email"
              value={form.email}
              placeholder="name@company.com"
              onChange={(value) => setForm((current) => ({ ...current, email: value }))}
            />
          </AiaBox>
          <AiaBox>
            <AiaText sx={fieldLabelSx}>ROLE</AiaText>
            <AiaSelect
              fullWidth
              value={form.role}
              options={ROLE_OPTIONS}
              onChange={(value) =>
                setForm((current) => ({ ...current, role: value as AdminUserRole }))
              }
            />
          </AiaBox>
          {lockEditable ? (
            <AiaBox>
              <AiaText sx={fieldLabelSx}>ACCOUNT ACCESS</AiaText>
              <AiaBox
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  minHeight: 40,
                  px: 1.5,
                  py: 1,
                  borderRadius: '8px',
                  border: '1px solid #E2E8F0',
                  bgcolor: '#FFFFFF',
                }}
              >
                <AiaBox sx={{ minWidth: 0 }}>
                  <AiaText sx={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                    {isUnlocked ? 'Unlocked' : 'Locked'}
                  </AiaText>
                  <AiaText sx={{ fontSize: 12, color: '#64748B', lineHeight: 1.45, mt: 0.25 }}>
                    {isUnlocked
                      ? 'User can sign in and access the application.'
                      : 'User access is revoked until unlocked.'}
                  </AiaText>
                </AiaBox>
                <AiaSwitch
                  checked={isUnlocked}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.checked ? 'Active' : 'Locked',
                    }))
                  }
                  sx={accountAccessSwitchSx}
                />
              </AiaBox>
            </AiaBox>
          ) : null}
        </AiaStack>
      </AiaDialogContent>
      <AiaDialogActions sx={{ px: 3, pb: 2.5 }}>
        <AiaButton variant="outlined" size="medium" onClick={onClose}>
          Cancel
        </AiaButton>
        <AiaButton
          variant="contained"
          color="primary"
          size="medium"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitLabel}
        </AiaButton>
      </AiaDialogActions>
    </AiaDialog>
  );
}
