'use client';

import { AiaBox, AiaButton, AiaPaper } from '@/components/ui';
import { FileDownloadOutlinedIcon } from '@/utils/icons';
import { useAdministration } from '../context/administration-context';
import AdminPageHeader from '../shared/admin-page-header';
import { exportAuditLogCsv } from '../shared/administration-utils';
import {
  adminContentScrollSx,
  adminPageShellSx,
} from '../shared/administration-ui-styles';
import AuditLogTable from './audit-log-table';

export default function AuditLogPage() {
  const { auditLog } = useAdministration();

  return (
    <AiaBox sx={adminPageShellSx}>
      <AiaBox sx={adminContentScrollSx}>
        <AiaBox className="px-5 py-4">
          <AdminPageHeader
            title="Audit Log"
            subtitle="Every mapping change, publish action, and user login — timestamped and attributed."
            actions={
              <AiaButton
                variant="outlined"
                size="small"
                customColor="var(--aia-button-color)"
                customBorderColor="var(--aia-button-color)"
                startIcon={<FileDownloadOutlinedIcon sx={{ fontSize: 16 }} />}
                onClick={() => exportAuditLogCsv(auditLog)}
              >
                Export
              </AiaButton>
            }
          />

          <AiaPaper
            elevation={0}
            sx={{
              mt: 3,
              borderRadius: '12px',
              border: '1px solid #E8ECF4',
              overflow: 'hidden',
              bgcolor: '#FFFFFF',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 520,
              maxHeight: 'calc(100vh - 260px)',
            }}
          >
            <AuditLogTable rows={auditLog} />
          </AiaPaper>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
