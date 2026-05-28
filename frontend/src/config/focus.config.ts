import type { ClientConfig } from "@/types/client-config";

export const FOCUS_CONFIG: ClientConfig = {
  clientId: "focus",

  app: {
    name: "Focus STTM",
    title: "Focus AI Migration Workbench",
    description: "Enterprise mapping, transformation and validation suite",
    clientTitle: "FOCUS FINANCIAL PARTNERS"
  },

  branding: {
    logo: {
      light: "/images/focus/focus_home_logo2_bg.png",
      dark: "/images/focus/focus_home_logo.svg",
      favicon: "/images/focus/favicon.ico",
      appIcon: "", // for PWA or header
    },

    font: {
      family: "'Inter', sans-serif",

      colors: {
        primary: "#111827",
        secondary: "#4B5563",
        muted: "#6B7280",
      },
    },

    colors: {
      primary: "#0057D9",
      secondary: "#00C9A7",

      background: {
        primary: "#ffffff",
        secondary: "#2d2d2d",
        default: "#e5e5e5",
        paper: "#FFFFFF",
        inverse: "#000000",
        surface: "#333",
        subtle: "#1a1a1a"
      },

      text: {
        primary: "#000000",
        secondary: "#6B7280",
        subtle: "#888",
        disabled: "#9CA3AF",
        inverse: "#888",

      },

      button: {
        primary: "#007bb2",
        secondary: "#000000",
        secondaryHover: "#333",
        inverse: "#0073a0",
        inverseHover: "#035c7f",



      },

      border: "#F1F1F1",
      header: '#F1F1F1',

      states: {
        success: "#10B981",
        warning: "#F59E0B",
        error: "#EF4444",
        info: "#3B82F6",
      },
    },
  },

  theme: {
    mode: "light",
    borderRadius: 8,
    shadows: {
      card: "0 1px 3px rgba(0,0,0,0.1)",
      panel: "0 2px 6px rgba(0,0,0,0.15)",
    },
    spacing: {
      xs: 4,
      sm: 8,
      md: 16,
      lg: 24,
      xl: 32,
    },
    layout: {
      headerHeight: 64,
      sidebarWidth: 260,
      rightPanelWidth: 320,
    },
  },

  assets: {
    basePath: "/clients/acme",
    illustrations: "/clients/acme/illustrations",
    icons: "/clients/acme/icons",
  },

  features: {
    aiAgent: true,
    validation: true,
    viewer: true,
    export: true,
  },
};
