'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AdminUserListItem,
  AuditLogListItem,
  MappingLockListItem,
  OwnershipTransferListItem,
} from '@/data/mock/administration';
import {
  MOCK_ADMIN_USERS,
  MOCK_AUDIT_LOG,
  MOCK_MAPPING_LOCKS,
  MOCK_OWNERSHIP_TRANSFERS,
} from '@/data/mock/administration';
import {
  CURRENT_ADMIN_ACTOR,
  buildUserListItem,
  canManageMappingLock,
  createAuditEntry,
  formatDisplayDate,
  formatDisplayTime,
  type UserProfileInput,
} from '../shared/administration-utils';

type AdministrationContextValue = {
  users: AdminUserListItem[];
  auditLog: AuditLogListItem[];
  ownershipItems: OwnershipTransferListItem[];
  mappingLocks: MappingLockListItem[];
  createUser: (input: UserProfileInput) => void;
  updateUser: (userId: string, input: UserProfileInput) => void;
  toggleUserLock: (userId: string) => void;
  transferOwnership: (itemId: string, newOwnerId: string) => void;
  lockMapping: (lockId: string) => void;
  unlockMapping: (lockId: string) => void;
};

const AdministrationContext = createContext<AdministrationContextValue | null>(null);

function prependAuditEntry(
  entries: AuditLogListItem[],
  entry: AuditLogListItem,
): AuditLogListItem[] {
  return [entry, ...entries];
}

export function AdministrationProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<AdminUserListItem[]>(MOCK_ADMIN_USERS);
  const [auditLog, setAuditLog] = useState<AuditLogListItem[]>(MOCK_AUDIT_LOG);
  const [ownershipItems, setOwnershipItems] =
    useState<OwnershipTransferListItem[]>(MOCK_OWNERSHIP_TRANSFERS);
  const [mappingLocks, setMappingLocks] = useState<MappingLockListItem[]>(MOCK_MAPPING_LOCKS);

  const createUser = useCallback((input: UserProfileInput) => {
    const nextUser = buildUserListItem(input);
    setUsers((current) => [...current, nextUser]);
    setAuditLog((current) =>
      prependAuditEntry(
        current,
        createAuditEntry(
          'User Created',
          nextUser.name,
          `Created ${nextUser.role} account for ${nextUser.email}`,
        ),
      ),
    );
  }, []);

  const updateUser = useCallback((userId: string, input: UserProfileInput) => {
    setUsers((current) => {
      const existingUser = current.find((user) => user.id === userId);
      if (!existingUser) {
        return current;
      }

      const trimmedName = input.name.trim();
      const nextStatus = existingUser.isPrimaryAdmin ? existingUser.status : input.status;

      if (nextStatus !== existingUser.status) {
        setAuditLog((log) =>
          prependAuditEntry(
            log,
            createAuditEntry(
              nextStatus === 'Locked' ? 'User Locked' : 'User Unlocked',
              trimmedName,
              nextStatus === 'Locked'
                ? 'Application access revoked by administrator'
                : 'Application access restored by administrator',
            ),
          ),
        );
      }

      return current.map((user) => {
        if (user.id !== userId) {
          return user;
        }

        return {
          ...user,
          name: trimmedName,
          initials: buildUserListItem({ ...input, status: nextStatus }, user.id).initials,
          email: input.email.trim(),
          role: input.role,
          status: nextStatus,
        };
      });
    });

    setAuditLog((current) =>
      prependAuditEntry(
        current,
        createAuditEntry(
          'User Updated',
          input.name.trim(),
          `Updated profile and role to ${input.role}`,
        ),
      ),
    );
  }, []);

  const toggleUserLock = useCallback((userId: string) => {
    setUsers((current) =>
      current.map((user) => {
        if (user.id !== userId || user.isPrimaryAdmin) {
          return user;
        }

        const nextStatus = user.status === 'Locked' ? 'Active' : 'Locked';
        setAuditLog((log) =>
          prependAuditEntry(
            log,
            createAuditEntry(
              nextStatus === 'Locked' ? 'User Locked' : 'User Unlocked',
              user.name,
              nextStatus === 'Locked'
                ? 'Application access revoked by administrator'
                : 'Application access restored by administrator',
            ),
          ),
        );

        return {
          ...user,
          status: nextStatus,
        };
      }),
    );
  }, []);

  const transferOwnership = useCallback((itemId: string, newOwnerId: string) => {
    const newOwner = users.find((user) => user.id === newOwnerId);
    if (!newOwner) {
      return;
    }

    setOwnershipItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        const previousOwner = item.owner.name;
        setAuditLog((log) =>
          prependAuditEntry(
            log,
            createAuditEntry(
              'Ownership Transferred',
              item.mappingName,
              `Transferred from ${previousOwner} to ${newOwner.name}`,
            ),
          ),
        );

        return {
          ...item,
          owner: { initials: newOwner.initials, name: newOwner.name },
          lastModified: formatDisplayDate(),
        };
      }),
    );
  }, [users]);

  const lockMapping = useCallback((lockId: string) => {
    setMappingLocks((current) =>
      current.map((item) => {
        if (item.id !== lockId || item.status === 'Locked') {
          return item;
        }

        if (!canManageMappingLock(item.activeUsers.length)) {
          return item;
        }

        setAuditLog((log) =>
          prependAuditEntry(
            log,
            createAuditEntry(
              'Mapping Locked',
              item.mappingName,
              `Locked by ${CURRENT_ADMIN_ACTOR.name} — ${item.activeUsers.length} concurrent editors`,
            ),
          ),
        );

        return {
          ...item,
          status: 'Locked',
          lockedBy: CURRENT_ADMIN_ACTOR.name,
          lockedSince: formatDisplayTime(),
        };
      }),
    );
  }, []);

  const unlockMapping = useCallback((lockId: string) => {
    setMappingLocks((current) =>
      current.map((item) => {
        if (item.id !== lockId || item.status === 'Unlocked') {
          return item;
        }

        setAuditLog((log) =>
          prependAuditEntry(
            log,
            createAuditEntry(
              'Mapping Unlocked',
              item.mappingName,
              `Force unlocked by ${CURRENT_ADMIN_ACTOR.name}`,
            ),
          ),
        );

        return {
          ...item,
          status: 'Unlocked',
          lockedBy: undefined,
          lockedSince: undefined,
        };
      }),
    );
  }, []);

  const value = useMemo(
    () => ({
      users,
      auditLog,
      ownershipItems,
      mappingLocks,
      createUser,
      updateUser,
      toggleUserLock,
      transferOwnership,
      lockMapping,
      unlockMapping,
    }),
    [
      auditLog,
      createUser,
      lockMapping,
      mappingLocks,
      ownershipItems,
      toggleUserLock,
      transferOwnership,
      unlockMapping,
      updateUser,
      users,
    ],
  );

  return (
    <AdministrationContext.Provider value={value}>{children}</AdministrationContext.Provider>
  );
}

export function useAdministration() {
  const context = useContext(AdministrationContext);

  if (!context) {
    throw new Error('useAdministration must be used inside AdministrationProvider');
  }

  return context;
}
