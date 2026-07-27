'use client';

import type { ReactNode } from 'react';
import { AiaAvatar, AiaBox, AiaButton, AiaChip, AiaPaper, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { CAPTION_SX } from '@/config/typography-tokens';
import { LockOpenOutlinedIcon, LockOutlinedIcon } from '@/utils/icons';
import type { MappingLockListItem } from './mapping-locks-data';
import {
  MAPPING_LOCK_CONCURRENT_USER_THRESHOLD,
  canManageMappingLock,
} from '../shared/administration-utils';
import { adminBodyEmphasisSx, adminMutedTextSx } from '../shared/administration-ui-styles';

const captionLabelSx = {
  ...CAPTION_SX,
  fontWeight: 400,
};

const captionValueSx = {
  ...CAPTION_SX,
  fontWeight: 700,
};

type LockMetaItemProps = {
  label: string;
  value: ReactNode;
};

function LockMetaItem({ label, value }: LockMetaItemProps) {
  return (
    <AiaBox sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <AiaText variant="caption" sx={captionLabelSx}>
        {label}
      </AiaText>
      {typeof value === 'string' || typeof value === 'number' ? (
        <AiaText variant="caption" sx={captionValueSx}>
          {value}
        </AiaText>
      ) : (
        value
      )}
    </AiaBox>
  );
}

type MappingLockCardProps = {
  item: MappingLockListItem;
  onLock: (lockId: string) => void;
  onUnlock: (lockId: string) => void;
};

export default function MappingLockCard({ item, onLock, onUnlock }: MappingLockCardProps) {
  const isLocked = item.status === 'Locked';
  const accentColor = isLocked ? '#F59E0B' : '#10B981';
  const activeUserCount = item.activeUsers.length;
  const lockEligible = canManageMappingLock(activeUserCount);
  const visibleUsers = item.activeUsers.slice(0, 3);
  const overflowCount = Math.max(0, item.activeUsers.length - visibleUsers.length);

  const lockDisabledReason = isLocked
    ? undefined
    : lockEligible
      ? undefined
      : `Lock is available when more than ${MAPPING_LOCK_CONCURRENT_USER_THRESHOLD} users are editing the same mapping.`;

  const actionButton = isLocked ? (
    <AiaButton
      variant="outlined"
      size="small"
      customColor="#DC2626"
      customBorderColor="#DC2626"
      startIcon={<LockOpenOutlinedIcon sx={{ fontSize: 14 }} />}
      onClick={() => onUnlock(item.id)}
    >
      Force Unlock
    </AiaButton>
  ) : (
    <AiaTooltip title={lockDisabledReason ?? ''} placement="top" arrow disableHoverListener={lockEligible}>
      <AiaBox component="span">
        <AiaButton
          variant="outlined"
          size="small"
          disabled={!lockEligible}
          customColor="#16A34A"
          customBorderColor="#16A34A"
          startIcon={<LockOutlinedIcon sx={{ fontSize: 14 }} />}
          onClick={() => onLock(item.id)}
        >
          Lock
        </AiaButton>
      </AiaBox>
    </AiaTooltip>
  );

  const activeUsersValue =
    item.activeUsers.length === 0 ? (
      'None'
    ) : (
      <AiaBox className="flex items-center">
        {visibleUsers.map((user, index) => (
          <AiaAvatar
            key={`${item.id}-${user.initials}`}
            title={user.name}
            sx={{
              width: 28,
              height: 28,
              bgcolor: '#111827',
              color: '#FFFFFF',
              fontSize: 11,
              fontWeight: 700,
              ml: index === 0 ? 0 : -0.75,
              border: '2px solid #FFFFFF',
            }}
          >
            {user.initials}
          </AiaAvatar>
        ))}
        {overflowCount > 0 ? (
          <AiaAvatar
            sx={{
              width: 28,
              height: 28,
              bgcolor: '#E2E8F0',
              color: '#475569',
              fontSize: 11,
              fontWeight: 700,
              ml: visibleUsers.length > 0 ? -0.75 : 0,
              border: '2px solid #FFFFFF',
            }}
          >
            +{overflowCount}
          </AiaAvatar>
        ) : null}
      </AiaBox>
    );

  return (
    <AiaPaper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: '12px',
        border: `1px solid ${isLocked ? '#FDE68A' : '#BBF7D0'}`,
        bgcolor: '#FFFFFF',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      <AiaBox
        sx={{
          width: 44,
          height: 44,
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: isLocked ? '#FFFBEB' : '#ECFDF5',
          color: accentColor,
          flexShrink: 0,
        }}
      >
        {isLocked ? (
          <LockOutlinedIcon sx={{ fontSize: 22 }} />
        ) : (
          <LockOpenOutlinedIcon sx={{ fontSize: 22 }} />
        )}
      </AiaBox>

      <AiaBox sx={{ flex: 1, minWidth: 220 }}>
        <AiaBox className="flex flex-wrap items-center gap-2">
          <AiaText sx={adminBodyEmphasisSx}>{item.mappingName}</AiaText>
          <AiaChip
            label={item.status}
            customBackgroundColor={isLocked ? '#FFFBEB' : '#ECFDF5'}
            customBorderColor={isLocked ? '#FDE68A' : '#BBF7D0'}
            customColor={isLocked ? '#B45309' : '#166534'}
          />
        </AiaBox>

        <AiaBox
          sx={{
            mt: 1,
            pl: 1,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          <LockMetaItem label="Locked by" value={isLocked ? item.lockedBy ?? '—' : '—'} />
          <LockMetaItem label="Since" value={isLocked ? item.lockedSince ?? '—' : '—'} />
          <LockMetaItem label="Active users" value={activeUsersValue} />
        </AiaBox>

        {!isLocked ? (
          <AiaText sx={{ ...adminMutedTextSx, mt: 1, pl: 1, fontSize: '12px' }}>
            {lockEligible
              ? `${activeUserCount} active editors — lock available to prevent conflicts`
              : `${activeUserCount} active editor${activeUserCount === 1 ? '' : 's'} — no lock required`}
          </AiaText>
        ) : null}
      </AiaBox>

      <AiaBox sx={{ alignSelf: 'center' }}>{actionButton}</AiaBox>
    </AiaPaper>
  );
}
