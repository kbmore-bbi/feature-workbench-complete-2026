import type { ClientConfig } from '@/types/client-config';
import {
  SHARED_CLIENT_ASSETS,
  SHARED_CLIENT_FEATURES,
  SHARED_CLIENT_FONT,
  SHARED_CLIENT_THEME,
} from './shared-client-config';

export const FOCUS_CONFIG: ClientConfig = {
  clientId: 'focus',

  app: {
    name: 'Focus STTM',
    title: 'Focus AI Migration Workbench',
    description: 'Enterprise mapping, transformation and validation suite',
    clientTitle: 'FOCUS FINANCIAL PARTNERS',
  },

  branding: {
    logo: {
      light: '/images/focus/focus_home_logo2.png',
      dark: '/images/focus/focus_home_logo.svg',
      favicon: '/images/focus/favicon.ico',
      appIcon: '',
    },

    font: SHARED_CLIENT_FONT,

    colors: {
      primary: '#2d2d2d',
      secondary: '#9fd1ef',

      background: {
        primary: '#ffffff',
        secondary: '#2d2d2d',
        default: '#e5e5e5',
        paper: '#FFFFFF',
        inverse: '#000000',
        surface: '#333',
        subtle: '#1a1a1a',
      },

      text: {
        primary: '#000000',
        secondary: '#6B7280',
        subtle: '#888',
        disabled: '#9CA3AF',
        inverse: '#888',
      },

      button: {
        primary: '#2d2d2d',
        primaryText: '#ffffff',
        primaryHover: '#404040',
        secondary: '#9fd1ef',
        secondaryText: '#ffffff',
        secondaryHover: '#9fd1ef',
        inverse: '#0073a0',
        inverseText: '#ffffff',
        inverseHover: '#035c7f',
      },

      border: '#F1F1F1',
      header: '#2d2d2d',
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
