'use client';

import { AiaBox } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import { sttmSidebarBodyTextMutedSx } from '@/features/sttm/layout/sttm-sidebar-text-styles';

export const WORKSPACE_EMPTY_MESSAGE_WRAPPER_SX = {
  px: 1.5,
  textAlign: 'center',
  width: '100%',
  maxWidth: 360,
} as const;

export const WORKSPACE_EMPTY_MESSAGE_TEXT_SX = {
  ...sttmSidebarBodyTextMutedSx,
  fontSize: 13,
  lineHeight: 1.6,
} as const;

type WorkspaceEmptyMessageProps = {
  children: React.ReactNode;
};

export function WorkspaceEmptyMessage({ children }: WorkspaceEmptyMessageProps) {
  return (
    <AiaBox sx={WORKSPACE_EMPTY_MESSAGE_WRAPPER_SX}>
      <AiaText sx={WORKSPACE_EMPTY_MESSAGE_TEXT_SX}>{children}</AiaText>
    </AiaBox>
  );
}
