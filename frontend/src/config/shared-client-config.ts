import type { ClientConfig } from '@/types/client-config';

/** Shared font tokens — same across all client configs. */
export const SHARED_CLIENT_FONT: ClientConfig['branding']['font'] = {
  family: "'Inter', sans-serif",
  colors: {
    primary: '#111827',
    secondary: '#4B5563',
    muted: '#6B7280',
  },
};

/** Shared theme tokens (typography, layout, spacing) — same across all client configs. */
export const SHARED_CLIENT_THEME: ClientConfig['theme'] = {
  mode: 'light',
  borderRadius: 8,
  shadows: {
    card: '0 1px 3px rgba(0,0,0,0.1)',
    panel: '0 2px 6px rgba(0,0,0,0.15)',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  typography: {
    pageTitle: {
      fontSize: 32,
      fontWeight: 700,
      lineHeight: 40,
      color: '#111827',
    },
    sectionTitle: {
      fontSize: 24,
      fontWeight: 600,
      lineHeight: 32,
      color: '#111827',
    },
    subtitle: {
      fontSize: 20,
      fontWeight: 600,
      lineHeight: 28,
      color: '#111827',
    },
    cardTitle: {
      fontSize: 18,
      fontWeight: 600,
      lineHeight: 26,
      color: '#111827',
    },
    body: {
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 24,
      color: '#111827',
    },
    secondaryText: {
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 20,
      color: '#6B7280',
    },
    caption: {
      fontSize: 12,
      fontWeight: 400,
      lineHeight: 16,
      color: '#6B7280',
    },
  },
  button: {
    large: {
      fontSize: 16,
      fontWeight: 600,
      paddingTop: 10,
      paddingBottom: 10,
      paddingX: 16,
      minHeight: 45,
      letterSpacing: 0.5,
    },
    medium: {
      fontSize: 14,
      fontWeight: 600,
      paddingTop: 8,
      paddingBottom: 8,
      paddingX: 14,
      minHeight: 38,
      letterSpacing: 0.4,
    },
    small: {
      fontSize: 12,
      fontWeight: 600,
      paddingTop: 6,
      paddingBottom: 6,
      paddingX: 12,
      minHeight: 32,
      letterSpacing: 0.3,
    },
  },
  layout: {
    headerHeight: 72,
    sidebarWidth: 260,
    rightPanelWidth: 320,
    sidebarNav: {
      itemHeight: 48,
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 24,
      iconSize: 20,
      iconSlotSize: 30,
      iconGap: 12,
      paddingX: 12,
      textColor: '#111827',
      iconColor: '#6B7280',
      activeTextColor: '#111827',
      activeIconColor: '#111827',
    },
  },
};

export const SHARED_CLIENT_ASSETS: ClientConfig['assets'] = {
  basePath: '/clients/acme',
  illustrations: '/clients/acme/illustrations',
  icons: '/clients/acme/icons',
};

export const SHARED_CLIENT_FEATURES: NonNullable<ClientConfig['features']> = {
  aiAgent: true,
  validation: true,
  viewer: true,
  export: true,
};
