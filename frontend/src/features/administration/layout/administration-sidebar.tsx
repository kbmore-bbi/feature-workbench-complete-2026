'use client';

import { AiaBox, AiaIconButton, AiaTooltip } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AdminPanelSettingsOutlinedIcon,
  AssignmentOutlinedIcon,
  EastRoundedIcon,
  KeyboardDoubleArrowLeftRoundedIcon,
  KeyboardDoubleArrowRightRoundedIcon,
  LockOutlinedIcon,
  PeopleOutlineRoundedIcon,
  VerifiedUserOutlinedIcon,
} from '@/utils/icons';
import { SIDEBAR_NAV_TOKENS } from '@/config/sidebar-nav-tokens';
import {
  ADMINISTRATION_NAV_ROUTES,
  COLLAPSED_ADMINISTRATION_SIDEBAR_WIDTH,
  EXPANDED_ADMINISTRATION_SIDEBAR_WIDTH,
  type AdministrationNavItem,
  resolveAdministrationNavItem,
} from './administration-sidebar-types';
import { useAdministrationSidebar } from './administration-sidebar-context';
import { TOUR_TARGETS } from '@/features/tour/constants/tour-targets';

const ADMIN_NAV_TOUR_TARGETS: Record<AdministrationNavItem, string> = {
  'User Management': TOUR_TARGETS.adminNavUserManagement,
  'Audit Log': TOUR_TARGETS.adminNavAuditLog,
  'Ownership Transfer': TOUR_TARGETS.adminNavOwnershipTransfer,
  'Mapping Locks': TOUR_TARGETS.adminNavMappingLocks,
  'Screen Permissions': TOUR_TARGETS.adminNavScreenPermissions,
};

const navItems: Array<{
  label: AdministrationNavItem;
  href: string;
  icon: typeof PeopleOutlineRoundedIcon;
}> = [
  {
    label: 'User Management',
    href: ADMINISTRATION_NAV_ROUTES['User Management'],
    icon: PeopleOutlineRoundedIcon,
  },
  {
    label: 'Audit Log',
    href: ADMINISTRATION_NAV_ROUTES['Audit Log'],
    icon: AssignmentOutlinedIcon,
  },
  {
    label: 'Ownership Transfer',
    href: ADMINISTRATION_NAV_ROUTES['Ownership Transfer'],
    icon: EastRoundedIcon,
  },
  {
    label: 'Mapping Locks',
    href: ADMINISTRATION_NAV_ROUTES['Mapping Locks'],
    icon: LockOutlinedIcon,
  },
  {
    label: 'Screen Permissions',
    href: ADMINISTRATION_NAV_ROUTES['Screen Permissions'],
    icon: VerifiedUserOutlinedIcon,
  },
];

const sidebarToggleButtonSx = {
  width: 32,
  height: 32,
  p: 0,
  color: '#64748B',
  border: '1px solid #DBE2EA',
  borderRadius: '50%',
  backgroundColor: '#FFFFFF',
  '&:hover': {
    backgroundColor: '#F8FAFC',
  },
} as const;

type AdministrationSidebarNavItemProps = {
  href: string;
  label: AdministrationNavItem;
  icon: typeof PeopleOutlineRoundedIcon;
  isActive: boolean;
  collapsed: boolean;
};

function AdministrationSidebarNavItem({
  href,
  label,
  icon: Icon,
  isActive,
  collapsed,
}: AdministrationSidebarNavItemProps) {
  const linkBody = (
    <AiaBox
      className={`flex w-full items-center rounded-xl ${collapsed ? 'justify-center px-0' : ''}`}
      sx={{
        height: 'var(--aia-sidebar-nav-item-height)',
        px: collapsed ? 0 : 'var(--aia-sidebar-nav-padding-x)',
        backgroundColor: isActive ? '#F8FAFC' : 'transparent',
        '&:hover': {
          backgroundColor: isActive ? '#F8FAFC' : '#F9FAFB',
        },
      }}
    >
      <AiaBox
        className={`flex min-w-0 items-center ${collapsed ? 'justify-center' : ''}`}
        sx={{ gap: collapsed ? 0 : 'var(--aia-sidebar-nav-icon-gap)' }}
      >
        <Icon
          sx={{
            fontSize: 'var(--aia-sidebar-nav-icon-size)',
            color: isActive
              ? 'var(--aia-sidebar-nav-active-icon-color)'
              : 'var(--aia-sidebar-nav-icon-color)',
            flexShrink: 0,
          }}
        />
        {!collapsed ? (
          <AiaText
            sx={{
              fontSize: 'var(--aia-sidebar-nav-font-size)',
              fontWeight: SIDEBAR_NAV_TOKENS.fontWeight,
              lineHeight: 'var(--aia-sidebar-nav-line-height)',
              color: isActive
                ? 'var(--aia-sidebar-nav-active-text-color)'
                : 'var(--aia-sidebar-nav-text-color)',
            }}
          >
            {label}
          </AiaText>
        ) : null}
      </AiaBox>
    </AiaBox>
  );

  const link = (
    <Link
      href={href}
      data-tour={ADMIN_NAV_TOUR_TARGETS[label]}
      aria-current={isActive ? 'page' : undefined}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        display: 'flex',
        width: '100%',
      }}
    >
      {linkBody}
    </Link>
  );

  if (!collapsed) {
    return link;
  }

  return (
    <AiaTooltip title={label} placement="right" arrow>
      <AiaBox component="span" sx={{ display: 'inline-flex', width: '100%' }}>
        {link}
      </AiaBox>
    </AiaTooltip>
  );
}

export default function AdministrationSidebar() {
  const pathname = usePathname();
  const { collapsed, setCollapsed, hydrated } = useAdministrationSidebar();
  const activeNav = resolveAdministrationNavItem(pathname);
  const sidebarWidth = collapsed
    ? COLLAPSED_ADMINISTRATION_SIDEBAR_WIDTH
    : EXPANDED_ADMINISTRATION_SIDEBAR_WIDTH;

  const header = collapsed ? (
    <AiaTooltip title="Administration" placement="right" arrow>
      <AiaBox
        className="flex items-center justify-center"
        sx={{
          width: '100%',
          height: 'var(--aia-sidebar-nav-item-height)',
        }}
      >
        <AdminPanelSettingsOutlinedIcon
          sx={{
            fontSize: 'var(--aia-sidebar-nav-icon-size)',
            color: 'var(--aia-sidebar-nav-icon-color)',
          }}
        />
      </AiaBox>
    </AiaTooltip>
  ) : (
    <AiaBox className="mb-1 flex items-center gap-2 px-2">
      <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 18, color: '#64748B' }} />
      <AiaText
        sx={{
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: '#94A3B8',
        }}
      >
        ADMINISTRATION
      </AiaText>
    </AiaBox>
  );

  return (
    <AiaBox
      data-tour={TOUR_TARGETS.adminSidebar}
      sx={{
        display: 'flex',
        width: hydrated ? sidebarWidth : EXPANDED_ADMINISTRATION_SIDEBAR_WIDTH,
        minWidth: hydrated ? sidebarWidth : EXPANDED_ADMINISTRATION_SIDEBAR_WIDTH,
        flexShrink: 0,
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        borderRight: '1px solid #E8ECF4',
        backgroundColor: '#FFFFFF',
        transition: hydrated ? 'width 160ms ease, min-width 160ms ease' : 'none',
        overflow: 'hidden',
      }}
    >
      <AiaBox
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: collapsed ? 'center' : 'stretch',
          px: collapsed ? 0 : 1.5,
          py: collapsed ? 2 : 2.5,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {header}

        <AiaBox className="mt-1 flex w-full flex-col gap-1">
          {navItems.map((item) => (
            <AdministrationSidebarNavItem
              key={item.label}
              href={item.href}
              label={item.label}
              icon={item.icon}
              isActive={activeNav === item.label}
              collapsed={collapsed}
            />
          ))}
        </AiaBox>
      </AiaBox>

      <AiaBox
        sx={{
          px: collapsed ? 0 : 1.5,
          py: 1,
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-start',
          width: '100%',
          alignItems: 'center',
          flexShrink: 0,
          borderTop: '1px solid #EEF2F7',
          backgroundColor: '#FFFFFF',
        }}
      >
        {collapsed ? (
          <AiaTooltip title="Expand sidebar" placement="right" arrow>
            <AiaIconButton
              aria-label="Expand administration sidebar"
              onClick={() => setCollapsed(false)}
              sx={sidebarToggleButtonSx}
            >
              <KeyboardDoubleArrowRightRoundedIcon sx={{ fontSize: 18 }} />
            </AiaIconButton>
          </AiaTooltip>
        ) : (
          <AiaIconButton
            aria-label="Collapse administration sidebar"
            onClick={() => setCollapsed(true)}
            sx={sidebarToggleButtonSx}
          >
            <KeyboardDoubleArrowLeftRoundedIcon sx={{ fontSize: 18 }} />
          </AiaIconButton>
        )}
      </AiaBox>
    </AiaBox>
  );
}
