'use client';

import { AiaBox, AiaStack } from '@/components/ui';
import { useAdministration } from '../context/administration-context';
import AdminPageHeader from '../shared/admin-page-header';
import {
  adminContentScrollSx,
  adminPageShellSx,
} from '../shared/administration-ui-styles';
import MappingLockCard from './mapping-lock-card';

export default function MappingLocksPage() {
  const { mappingLocks, lockMapping, unlockMapping } = useAdministration();

  return (
    <AiaBox sx={adminPageShellSx}>
      <AiaBox sx={adminContentScrollSx}>
        <AiaBox className="px-5 py-4">
          <AdminPageHeader
            title="Mapping Lock Control"
            subtitle="Manage concurrent editing — lock or force-unlock mappings when more than two users are active on the same mapping."
          />

          <AiaStack spacing={1.5} sx={{ mt: 3 }}>
            {mappingLocks.map((item) => (
              <MappingLockCard
                key={item.id}
                item={item}
                onLock={lockMapping}
                onUnlock={unlockMapping}
              />
            ))}
          </AiaStack>
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
