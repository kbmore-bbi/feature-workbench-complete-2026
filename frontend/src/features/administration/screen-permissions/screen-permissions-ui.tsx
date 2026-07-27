'use client';

import {
  AiaAccordion,
  AiaAccordionDetails,
  AiaAccordionSummary,
  AiaBox,
  AiaButton,
  AiaChip,
  AiaIconButton,
  AiaPaper,
} from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import {
  EditOutlinedIcon,
  ExpandMoreIcon,
  FiberManualRecordRoundedIcon,
  VisibilityOffOutlinedIcon,
  VisibilityOutlinedIcon,
} from '@/utils/icons';
import type { ReactNode } from 'react';
import type { ScreenPermissionLevel } from '@/data/mock/administration';
import {
  adminBodyCellSx,
  adminBodyEmphasisSx,
  adminMutedTextSx,
} from '../shared/administration-ui-styles';

const PERMISSION_LABELS: Record<ScreenPermissionLevel, string> = {
  edit: 'Edit',
  view: 'View',
  hidden: 'Hidden',
};

const PERMISSION_CHIP_COLORS: Record<
  ScreenPermissionLevel,
  { bg: string; border: string; text: string }
> = {
  edit: { bg: '#ECFDF5', border: '#BBF7D0', text: '#166534' },
  view: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' },
  hidden: { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C' },
};

type PermissionToggleProps = {
  level: ScreenPermissionLevel;
  active: boolean;
  onClick: () => void;
};

function PermissionToggle({ level, active, onClick }: PermissionToggleProps) {
  const icon =
    level === 'edit' ? (
      <EditOutlinedIcon sx={{ fontSize: 16 }} />
    ) : level === 'view' ? (
      <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />
    ) : (
      <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} />
    );

  const activeColor =
    level === 'edit' ? '#16A34A' : level === 'view' ? '#2563EB' : '#DC2626';

  return (
    <AiaIconButton
      aria-label={PERMISSION_LABELS[level]}
      onClick={onClick}
      sx={{
        width: 32,
        height: 32,
        borderRadius: '8px',
        border: `1px solid ${active ? activeColor : '#E2E8F0'}`,
        bgcolor: active ? `${activeColor}14` : '#FFFFFF',
        color: active ? activeColor : '#94A3B8',
        '&:hover': {
          bgcolor: active ? `${activeColor}20` : '#F8FAFC',
        },
      }}
    >
      {icon}
    </AiaIconButton>
  );
}

type PermissionControlsProps = {
  value: ScreenPermissionLevel;
  onChange: (next: ScreenPermissionLevel) => void;
  compact?: boolean;
};

export function PermissionControls({ value, onChange, compact = false }: PermissionControlsProps) {
  const levels: ScreenPermissionLevel[] = ['edit', 'view', 'hidden'];

  if (compact) {
    return (
      <AiaBox className="flex items-center gap-1">
        {levels.map((level) => (
          <AiaButton
            key={level}
            variant="outlined"
            size="small"
            onClick={() => onChange(level)}
            customColor={value === level ? PERMISSION_CHIP_COLORS[level].text : '#64748B'}
            customBorderColor={value === level ? PERMISSION_CHIP_COLORS[level].border : '#E2E8F0'}
            sx={{ minWidth: 0, px: 1.25 }}
          >
            {PERMISSION_LABELS[level]}
          </AiaButton>
        ))}
      </AiaBox>
    );
  }

  return (
    <AiaBox className="flex items-center gap-1.5">
      <AiaChip
        label={PERMISSION_LABELS[value]}
        customBackgroundColor={PERMISSION_CHIP_COLORS[value].bg}
        customBorderColor={PERMISSION_CHIP_COLORS[value].border}
        customColor={PERMISSION_CHIP_COLORS[value].text}
      />
      {levels.map((level) => (
        <PermissionToggle
          key={level}
          level={level}
          active={value === level}
          onClick={() => onChange(level)}
        />
      ))}
    </AiaBox>
  );
}

type ScreenPermissionSectionAccordionProps = {
  title: string;
  screenCount: number;
  children: ReactNode;
  onBulkChange: (level: ScreenPermissionLevel) => void;
};

export function ScreenPermissionSectionAccordion({
  title,
  screenCount,
  children,
  onBulkChange,
}: ScreenPermissionSectionAccordionProps) {
  return (
    <AiaAccordion
      defaultExpanded
      disableGutters
      elevation={0}
      sx={{
        border: '1px solid #E8ECF4',
        borderRadius: '12px !important',
        overflow: 'hidden',
        '&:before': { display: 'none' },
        bgcolor: '#FFFFFF',
      }}
    >
      <AiaAccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ color: '#64748B' }} />}
        sx={{
          px: 2,
          py: 1,
          minHeight: 56,
          '& .MuiAccordionSummary-content': {
            my: 1,
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          },
        }}
      >
        <AiaBox>
          <AiaText sx={adminBodyEmphasisSx}>{title}</AiaText>
          <AiaText sx={{ ...adminMutedTextSx, mt: 0.25 }}>{screenCount} screens</AiaText>
        </AiaBox>
        <AiaBox className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          {(['edit', 'view', 'hidden'] as ScreenPermissionLevel[]).map((level) => (
            <AiaButton
              key={level}
              variant="outlined"
              size="small"
              onClick={() => onBulkChange(level)}
              customColor={PERMISSION_CHIP_COLORS[level].text}
              customBorderColor={PERMISSION_CHIP_COLORS[level].border}
              sx={{ minWidth: 0, px: 1.25 }}
            >
              {PERMISSION_LABELS[level]}
            </AiaButton>
          ))}
        </AiaBox>
      </AiaAccordionSummary>
      <AiaAccordionDetails sx={{ px: 0, pb: 0 }}>{children}</AiaAccordionDetails>
    </AiaAccordion>
  );
}

type ScreenPermissionRowProps = {
  title: string;
  description: string;
  value: ScreenPermissionLevel;
  onChange: (next: ScreenPermissionLevel) => void;
};

export function ScreenPermissionRow({
  title,
  description,
  value,
  onChange,
}: ScreenPermissionRowProps) {
  return (
    <AiaBox
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        px: 2,
        py: 1.5,
        borderTop: '1px solid #F1F5F9',
      }}
    >
      <AiaBox sx={{ minWidth: 0 }}>
        <AiaText sx={adminBodyEmphasisSx}>{title}</AiaText>
        <AiaText sx={{ ...adminBodyCellSx, mt: 0.25 }}>{description}</AiaText>
      </AiaBox>
      <PermissionControls value={value} onChange={onChange} />
    </AiaBox>
  );
}

export function ScreenPermissionsLegend() {
  return (
    <AiaPaper
      elevation={0}
      sx={{
        mt: 2,
        p: 2,
        borderRadius: '12px',
        border: '1px solid #E8ECF4',
        bgcolor: '#FFFFFF',
      }}
    >
      <AiaBox className="flex flex-wrap items-center gap-4">
        {(['edit', 'view', 'hidden'] as ScreenPermissionLevel[]).map((level) => (
          <AiaBox key={level} className="flex items-center gap-1.5">
            <FiberManualRecordRoundedIcon
              sx={{ fontSize: 10, color: PERMISSION_CHIP_COLORS[level].text }}
            />
            <AiaText sx={adminBodyCellSx}>
              <strong>{PERMISSION_LABELS[level]}</strong>
              {level === 'edit'
                ? ' — Full read/write access'
                : level === 'view'
                  ? ' — Read-only, no editing'
                  : ' — Screen not visible'}
            </AiaText>
          </AiaBox>
        ))}
      </AiaBox>
    </AiaPaper>
  );
}
