export type AppNavItem = "Dashboard" | "Projects" | "Mappings";

export const APP_NAV_ROUTES: Record<AppNavItem, string> = {
  Dashboard: "/dashboard",
  Projects: "/projects",
  Mappings: "/mappings",
};

export const APP_SIDEBAR_STORAGE_KEY = "app-sidebar-collapsed";

export const APP_SIDEBAR_EXCLUDED_PATHS = ["/home"] as const;

export function shouldShowAppSidebar(pathname: string): boolean {
  return !APP_SIDEBAR_EXCLUDED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function resolveAppNavItem(pathname: string): AppNavItem | undefined {
  if (pathname === APP_NAV_ROUTES.Dashboard || pathname.startsWith(`${APP_NAV_ROUTES.Dashboard}/`)) {
    return "Dashboard";
  }
  if (pathname === APP_NAV_ROUTES.Projects || pathname.startsWith(`${APP_NAV_ROUTES.Projects}/`)) {
    return "Projects";
  }
  if (pathname === APP_NAV_ROUTES.Mappings || pathname.startsWith(`${APP_NAV_ROUTES.Mappings}/`)) {
    return "Mappings";
  }
  return undefined;
}
