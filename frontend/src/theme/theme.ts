import { createTheme } from "@mui/material/styles";
import { CLIENT_CONFIG as config } from '@/config/client.config';
import { tokenLineHeight } from '@/config/typography-tokens';

export type AppThemeMode = "light" | "dark";

export function getAppTheme(mode: AppThemeMode) {
  const isDark = mode === "dark";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: "#0082b5",
        dark: "#035c7f",
        contrastText: "#ffffff",
      },
      background: {
        default: isDark ? "#151515" : "#f7f8fa",
        paper: isDark ? "#494747" : "#ffffff",
      },
      text: {
        primary: isDark ? "#f3f4f6" : "#2d2d2d",
        secondary: isDark ? "#b8b8b8" : "#6b7280",
      },
      divider: isDark ? "#333333" : "#e8ecf4",
    },

    typography: {
      // Make body text 16px across the application.
      fontSize: config.theme.typography.body.fontSize,
      fontFamily: "museo-sans, sans-serif",
      h1: {
        fontFamily: "Gilroy-ExtraBold, museo-sans, sans-serif",
      },
      h2: {
        fontFamily: "Gilroy-ExtraBold, museo-sans, sans-serif",
      },
      h3: {
        fontFamily: "Gilroy-ExtraBold, museo-sans, sans-serif",
      },
      h4: {
        fontFamily: "Gilroy-ExtraBold, museo-sans, sans-serif",
      },
      h5: {
        fontFamily: "Gilroy-ExtraBold, museo-sans, sans-serif",
      },
      h6: {
        fontFamily: "Gilroy-ExtraBold, museo-sans, sans-serif",
      },
      button: {
        fontFamily: "museo-sans, sans-serif",
        textTransform: "none",
      },
    },

    shape: {
      borderRadius: 4,
    },

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': {
            /* Colors */
            '--aia-header-bgColor': config.branding.colors.header,
            '--color-header-bg': config.branding.colors.header,
            '--color-header-text': config.branding.colors.headerText,
            '--aia-primary-bg-color': config.branding.colors.header,
            '--aia-primary-bg-text-color': config.branding.colors.headerText,
            '--aia-primary-bg-hover-color': config.branding.colors.button.primaryHover,
            '--aia-header-height': `${config.theme.layout.headerHeight}px`,
            '--aia-sidebar-nav-item-height': `${config.theme.layout.sidebarNav.itemHeight}px`,
            '--aia-sidebar-nav-font-size': `${config.theme.layout.sidebarNav.fontSize}px`,
            '--aia-sidebar-nav-font-weight': String(config.theme.layout.sidebarNav.fontWeight),
            '--aia-sidebar-nav-line-height': String(tokenLineHeight({
              fontSize: config.theme.layout.sidebarNav.fontSize,
              lineHeight: config.theme.layout.sidebarNav.lineHeight,
            })),
            '--aia-sidebar-nav-icon-size': `${config.theme.layout.sidebarNav.iconSize}px`,
            '--aia-sidebar-nav-icon-gap': `${config.theme.layout.sidebarNav.iconGap}px`,
            '--aia-sidebar-nav-padding-x': `${config.theme.layout.sidebarNav.paddingX}px`,
            '--aia-sidebar-nav-text-color': config.theme.layout.sidebarNav.textColor,
            '--aia-sidebar-nav-icon-color': config.theme.layout.sidebarNav.iconColor,
            '--aia-sidebar-nav-active-text-color': config.theme.layout.sidebarNav.activeTextColor,
            '--aia-sidebar-nav-active-icon-color': config.theme.layout.sidebarNav.activeIconColor,
            '--aia-page-title-font-size': `${config.theme.typography.pageTitle.fontSize}px`,
            '--aia-page-title-font-weight': String(config.theme.typography.pageTitle.fontWeight),
            '--aia-page-title-line-height': String(tokenLineHeight(config.theme.typography.pageTitle)),
            '--aia-page-title-color': config.theme.typography.pageTitle.color,
            '--aia-section-title-font-size': `${config.theme.typography.sectionTitle.fontSize}px`,
            '--aia-section-title-font-weight': String(config.theme.typography.sectionTitle.fontWeight),
            '--aia-section-title-line-height': String(tokenLineHeight(config.theme.typography.sectionTitle)),
            '--aia-section-title-color': config.theme.typography.sectionTitle.color,
            '--aia-subtitle-font-size': `${config.theme.typography.subtitle.fontSize}px`,
            '--aia-subtitle-font-weight': String(config.theme.typography.subtitle.fontWeight),
            '--aia-subtitle-line-height': String(tokenLineHeight(config.theme.typography.subtitle)),
            '--aia-subtitle-color': config.theme.typography.subtitle.color,
            '--aia-card-title-font-size': `${config.theme.typography.cardTitle.fontSize}px`,
            '--aia-card-title-font-weight': String(config.theme.typography.cardTitle.fontWeight),
            '--aia-card-title-line-height': String(tokenLineHeight(config.theme.typography.cardTitle)),
            '--aia-card-title-color': config.theme.typography.cardTitle.color,
            '--aia-body-font-size': `${config.theme.typography.body.fontSize}px`,
            '--aia-body-font-weight': String(config.theme.typography.body.fontWeight),
            '--aia-body-line-height': String(tokenLineHeight(config.theme.typography.body)),
            '--aia-body-color': config.theme.typography.body.color,
            '--aia-type-secondary-text-font-size': `${config.theme.typography.secondaryText.fontSize}px`,
            '--aia-type-secondary-text-font-weight': String(config.theme.typography.secondaryText.fontWeight),
            '--aia-type-secondary-text-line-height': String(tokenLineHeight(config.theme.typography.secondaryText)),
            '--aia-type-secondary-text-color': config.theme.typography.secondaryText.color,
            '--aia-caption-font-size': `${config.theme.typography.caption.fontSize}px`,
            '--aia-caption-font-weight': String(config.theme.typography.caption.fontWeight),
            '--aia-caption-line-height': String(tokenLineHeight(config.theme.typography.caption)),
            '--aia-caption-color': config.theme.typography.caption.color,
            '--color-primary': config.branding.colors.primary,
            '--color-primary-save': config.branding.colors.primary,
            '--aia-selection-bg': `color-mix(in srgb, ${config.branding.colors.primary} 12%, #ffffff)`,
            '--aia-workspace-section-header-min-height': '52px',
            '--aia-state-success-color': config.branding.colors.states.success,
            '--aia-state-success-hover-bg': `color-mix(in srgb, ${config.branding.colors.states.success} 8%, transparent)`,
            '--aia-card-color': config.branding.colors.background.default,
            '--aia-button-color': config.branding.colors.button.primary,
            '--aia-button-text-color': config.branding.colors.button.primaryText,
            '--aia-button-hover-color': config.branding.colors.button.primaryHover,
            '--aia-secondary-button-color': config.branding.colors.button.secondary,
            '--aia-secondary-button-text-color': config.branding.colors.button.secondaryText,
            '--aia-secondary-button-colorHover': config.branding.colors.button.secondaryHover,
            '--color-transparent-button-text': config.branding.colors.button.secondaryText,
            '--color-transparent-button-border': config.branding.colors.button.secondary,
            '--aia-assitant-header-color': config.branding.colors.background.inverse,
            '--aia-assitant-header-textColor': config.branding.colors.background.paper,
            '--aia-assitant-avatar-bgColor': config.branding.colors.background.surface,
            '--aia-assitant-textColor': config.branding.colors.text.subtle,
            '--aia-assitant-subheader-color': config.branding.colors.background.subtle,
            '--aia-assitant-table-textColor': config.branding.colors.text.inverse,
            '--aia-mapping-button-color': config.branding.colors.button.inverse,
            '--aia-mapping-button-text-color': config.branding.colors.button.inverseText,
            '--aia-mapping-button-hoverColor': config.branding.colors.button.inverseHover,
            '--aia-secondary-color': config.branding.colors.secondary,
            '--aia-primary-text-color': config.branding.colors.text.primary,
            '--aia-secondary-text-color': config.branding.colors.text.secondary,
            '--aia-avatar-bg':config.branding.colors.background.primary,
            '--aia-avatar-textColor':config.branding.colors.background.secondary,
            '--aia-header-color': config.branding.colors.background.default,
            '--aia-border-color': config.branding.colors.border,
          },
          body: {
            fontFamily: "museo-sans, sans-serif",
            fontSize: `${config.theme.typography.body.fontSize}px`,
            backgroundColor: isDark ? "#151515" : "#f7f8fa",
            color: isDark ? "#f3f4f6" : "#2d2d2d",
          },
        },
      },

      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            textTransform: "none",
            fontFamily: "museo-sans, sans-serif",
            boxShadow: "none",
            "&:hover": {
              boxShadow: "none",
            },
          },
          sizeSmall: {
            fontSize: `${config.theme.button.small.fontSize}px`,
            fontWeight: config.theme.button.small.fontWeight,
            paddingTop: `${config.theme.button.small.paddingTop}px`,
            paddingBottom: `${config.theme.button.small.paddingBottom}px`,
            paddingLeft: `${config.theme.button.small.paddingX}px`,
            paddingRight: `${config.theme.button.small.paddingX}px`,
            minHeight: `${config.theme.button.small.minHeight}px`,
            letterSpacing: `${config.theme.button.small.letterSpacing}px`,
          },
          sizeMedium: {
            fontSize: `${config.theme.button.medium.fontSize}px`,
            fontWeight: config.theme.button.medium.fontWeight,
            paddingTop: `${config.theme.button.medium.paddingTop}px`,
            paddingBottom: `${config.theme.button.medium.paddingBottom}px`,
            paddingLeft: `${config.theme.button.medium.paddingX}px`,
            paddingRight: `${config.theme.button.medium.paddingX}px`,
            minHeight: `${config.theme.button.medium.minHeight}px`,
            letterSpacing: `${config.theme.button.medium.letterSpacing}px`,
          },
          sizeLarge: {
            fontSize: `${config.theme.button.large.fontSize}px`,
            fontWeight: config.theme.button.large.fontWeight,
            paddingTop: `${config.theme.button.large.paddingTop}px`,
            paddingBottom: `${config.theme.button.large.paddingBottom}px`,
            paddingLeft: `${config.theme.button.large.paddingX}px`,
            paddingRight: `${config.theme.button.large.paddingX}px`,
            minHeight: `${config.theme.button.large.minHeight}px`,
            letterSpacing: `${config.theme.button.large.letterSpacing}px`,
          },
        },
          variants: [
            {
              props: { variant: "contained", color: "primary" },
              style: {
                backgroundColor: "var(--aia-button-color)",
                color: "var(--aia-button-text-color)",
                border: "1px solid var(--aia-button-color)",
                "&:hover": {
                  backgroundColor: "var(--aia-button-hover-color)",
                  borderColor: "var(--aia-button-hover-color)",
                  color: "var(--aia-button-text-color)",
                },
                "&.Mui-disabled": {
                  opacity: "0.5 !important",
                  color: "var(--aia-button-text-color) !important",
                  backgroundColor: "var(--aia-button-color) !important",
                  borderColor: "var(--aia-button-color) !important",
                },
              },
            },
            {
              props: { variant: "outlined" },
              style: {
                backgroundColor: "transparent !important",
                borderColor: "currentColor",
                "&:hover": {
                  backgroundColor: "transparent !important",
                  borderColor: "currentColor",
                },
                "&.Mui-disabled": {
                  backgroundColor: "transparent !important",
                  opacity: "0.5 !important",
                  borderColor: "currentColor !important",
                  WebkitTextFillColor: "unset",
                },
              },
            },
            {
              props: { variant: "contained", color: "secondary" },
              style: {
                backgroundColor: "var(--aia-mapping-button-color)",
                color: "var(--aia-mapping-button-text-color)",
                border: "1px solid var(--aia-mapping-button-color)",
                "&:hover": {
                  backgroundColor: "var(--aia-mapping-button-hoverColor)",
                  borderColor: "var(--aia-mapping-button-hoverColor)",
                  color: "var(--aia-mapping-button-text-color)",
                },
                "&.Mui-disabled": {
                  opacity: "0.5 !important",
                  color: "var(--aia-mapping-button-text-color) !important",
                  backgroundColor: "var(--aia-mapping-button-color) !important",
                  borderColor: "var(--aia-mapping-button-color) !important",
                },
              },
            },
          ],
      },
    

      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 3,
            fontFamily: "museo-sans, sans-serif",
            backgroundColor: isDark ? "#494747" : "#ffffff",
            color: isDark ? "#f3f4f6" : "#2d2d2d",
            "& fieldset": {
              borderColor: isDark ? "#444444" : "#cccccc",
              borderWidth: 1,
            },
            "&:hover fieldset": {
              borderColor: isDark ? "#555555" : "#cccccc",
            },
            "&.Mui-focused fieldset": {
              borderColor: "#0082b5",
            },
          },
        },
      },

      MuiInputLabel: {
        styleOverrides: {
          root: {
            color: isDark ? "#ffffff" : "#000000",
            fontFamily: "museo-sans, sans-serif",
            "&.Mui-focused": {
              color: "#0082b5",
            },
          },
        },
      },

      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
        },
      },

      MuiLink: {
        styleOverrides: {
          root: {
            color: "#5fb3e4",
            textDecoration: "underline",
          },
        },
      },

      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            backgroundColor: isDark ? "#494747" : "#ffffff",
            color: isDark ? "#f3f4f6" : "#2d2d2d",
          },
        },
      },
    },
  });
}