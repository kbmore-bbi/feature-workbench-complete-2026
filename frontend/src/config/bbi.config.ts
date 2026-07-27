import type { ClientConfig } from '@/types/client-config';
import {
  SHARED_CLIENT_ASSETS,
  SHARED_CLIENT_FEATURES,
  SHARED_CLIENT_FONT,
  SHARED_CLIENT_THEME,
} from './shared-client-config';

export const BBI_CONFIG: ClientConfig = {
  clientId: 'bbi',

  app: {
    name: 'BBI STTM',
    title: 'BBI AI Migration Workbench',
    description: 'Data management platform powered by BBI',
    clientTitle: 'BLACKBUCK INSIGHTS',
  },

  branding: {
    logo: {
      light: '/images/bbi/BBI_Logo.webp',
      dark: '/images/bbi/BBI_Logo.webp',
      favicon: '/images/bbi/favicon.ico',
      appIcon: '',
    },

    font: SHARED_CLIENT_FONT,

    colors: {
      primary: '#003d59',
      secondary: '#fe6625',

      background: {
        primary: '#003d59',
        secondary: '#ffffff',
        default: '#003d59',
        paper: '#fff',
        subtle: '#ffffff',
        inverse: '#003d59',
        surface: '#333',
      },

      text: {
        primary: '#ffffff',
        secondary: '#000000',
        disabled: '#9CA3AF',
        subtle: '#ffffff',
        inverse: '#000000',
      },

      button: {
        primary: '#003d59',
        primaryText: '#ffffff',
        primaryHover: '#012c3f',
        secondary: '#fe6625',
        secondaryText: '#ffffff',
        secondaryHover: '#e55a1f',
        inverse: '#003d59',
        inverseText: '#ffffff',
        inverseHover: '#0b6b93',
      },

      border: '#003d59',
      header: '#003d59',
      headerText: '#ffffff',

      states: {
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
        info: '#3B82F6',
      },
    },
  },

  theme: SHARED_CLIENT_THEME,
  assets: SHARED_CLIENT_ASSETS,
  features: SHARED_CLIENT_FEATURES,
};
