export interface TextStyleToken {
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  color: string;
}

export interface ButtonSizeToken {
  fontSize: number;
  fontWeight: number;
  paddingTop: number;
  paddingBottom: number;
  paddingX: number;
  minHeight: number;
  letterSpacing: number;
}

export interface ClientConfig {
  clientId: string;

  app: {
    name: string;
    title: string;
    description?: string;
    clientTitle?: string;
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
        primary: string,
        secondary: string,
        default: string;
        paper: string;
        subtle: string;
        inverse: string;
        surface: string;
      };

      text: {
        primary: string;
        secondary: string;
        disabled: string;
        subtle: string;
        inverse: string
      };

      button: {
        primary: string;
        primaryText: string;
        primaryHover: string;
        secondary: string;
        secondaryText: string;
        secondaryHover: string;
        inverse: string;
        inverseText: string;
        inverseHover: string;
      }

      border: string;
      header: string;
      headerText: string;

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
    typography: {
      pageTitle: TextStyleToken;
      sectionTitle: TextStyleToken;
      subtitle: TextStyleToken;
      cardTitle: TextStyleToken;
      body: TextStyleToken;
      secondaryText: TextStyleToken;
      caption: TextStyleToken;
    };
    button: {
      large: ButtonSizeToken;
      medium: ButtonSizeToken;
      small: ButtonSizeToken;
    };
    layout: {
      headerHeight: number;
      sidebarWidth: number;
      rightPanelWidth: number;
      /** Shared nav row styling for app sidebar and STTM section headers. */
      sidebarNav: {
        itemHeight: number;
        fontSize: number;
        fontWeight: number;
        lineHeight: number;
        iconSize: number;
        /** Min square slot for section header icons (prevents glyph clipping). */
        iconSlotSize: number;
        iconGap: number;
        paddingX: number;
        textColor: string;
        iconColor: string;
        activeTextColor: string;
        activeIconColor: string;
      };
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
