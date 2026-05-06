import type { ClientConfig } from "@/types/client-config";

export const CLIENT_CONFIG: ClientConfig = {
  clientId: "acme",

  app: {
    name: "Acme STTM",
    title: "Acme Data Mapping Studio",
    description: "Enterprise mapping, transformation and validation suite",
  },

  branding: {
    logo: {
      light: "/clients/acme/logo-light.svg",
      dark: "/clients/acme/logo-dark.svg",
      favicon: "/clients/acme/favicon.ico",
      appIcon: "/clients/acme/app-icon.png", // for PWA or header
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
        default: "#F9FAFB",
        paper: "#FFFFFF",
        subtle: "#F3F4F6",
      },

      text: {
        primary: "#111827",
        secondary: "#6B7280",
        disabled: "#9CA3AF",
      },

      border: "#E5E7EB",

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
