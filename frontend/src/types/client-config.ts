export interface ClientConfig {
  clientId: string;

  app: {
    name: string;
    title: string;
    description?: string;
  };

  branding: {
    logo: {
      light: string;
      dark?: string;
      favicon?: string;
      appIcon?: string;
    };

    font: {
      family: string;
      colors: {
        primary: string;
        secondary: string;
        muted: string;
      };
    };

    colors: {
      primary: string;
      secondary: string;

      background: {
        default: string;
        paper: string;
        subtle: string;
      };

      text: {
        primary: string;
        secondary: string;
        disabled: string;
      };

      border: string;

      states: {
        success: string;
        warning: string;
        error: string;
        info: string;
      };
    };
  };

  theme: {
    mode: "light" | "dark";
    borderRadius: number;
    shadows: {
      card: string;
      panel: string;
    };
    spacing: {
      xs: number;
      sm: number;
      md: number;
      lg: number;
      xl: number;
    };
    layout: {
      headerHeight: number;
      sidebarWidth: number;
      rightPanelWidth: number;
    };
  };

  assets: {
    basePath: string;
    illustrations?: string;
    icons?: string;
  };

  features?: {
    aiAgent?: boolean;
    validation?: boolean;
    viewer?: boolean;
    export?: boolean;
  };
}
