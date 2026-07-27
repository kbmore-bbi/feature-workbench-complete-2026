export type AdministrationNavItem =
  | 'User Management'
  | 'Audit Log'
  | 'Ownership Transfer'
  | 'Mapping Locks'
  | 'Screen Permissions';

export const ADMINISTRATION_NAV_ROUTES: Record<AdministrationNavItem, string> = {
  'User Management': '/administration/user-management',
  'Audit Log': '/administration/audit-log',
  'Ownership Transfer': '/administration/ownership-transfer',
  'Mapping Locks': '/administration/mapping-locks',
  'Screen Permissions': '/administration/screen-permissions',
};

export const ADMINISTRATION_DEFAULT_ROUTE = ADMINISTRATION_NAV_ROUTES['User Management'];

export const ADMINISTRATION_SIDEBAR_STORAGE_KEY = 'administration-sidebar-collapsed';

export const EXPANDED_ADMINISTRATION_SIDEBAR_WIDTH = 240;
export const COLLAPSED_ADMINISTRATION_SIDEBAR_WIDTH = 70;

export function resolveAdministrationNavItem(pathname: string): AdministrationNavItem | undefined {
  const entries = Object.entries(ADMINISTRATION_NAV_ROUTES) as Array<[AdministrationNavItem, string]>;

  for (const [label, route] of entries) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return label;
    }
  }

  if (pathname === '/administration' || pathname.startsWith('/administration/')) {
    return 'User Management';
  }

  return undefined;
}
