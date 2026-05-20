import type { ClientConfig } from "@/types/client-config";

export const BBI_CONFIG: ClientConfig = {
  clientId: "bbi",

  app: {
    name: "BBI STTM",
    title: "BBI AI Migration Workbench",
    description: "Data management platform powered by BBI",
    clientTitle: "BLACKBUCK INSIGHTS"

  },

  branding: {
    logo: {
      light: "/images/bbi/BBI_Logo.webp",
      dark: "/images/bbi/BBI_Logo.webp",
      favicon: "/images/bbi/favicon.ico",
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
      primary: "#003D59",
      secondary: "#012c3f",

      background: {
        primary: "#003D59",
        secondary: "#ffffff",
        default: "#003D59",
        paper: "#fff",
        subtle: "#ffffff",
        inverse: "#003D59",
        surface: "333",
      },

      text: {
        primary: "#ffffff",
        secondary: "#000000",
        disabled: "#9CA3AF",
        subtle: "#ffffff",
        inverse: "#000000"

      },
      button: {
        primary: "#003D59",
        secondary: "#003D59",
        secondaryHover: "#012c3f",
        inverse: "#003D59",
        inverseHover: "#0b6b93",
      },


      border: "#003D59",
      header: "#ffffff",

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
