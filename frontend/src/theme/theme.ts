import { createTheme } from "@mui/material/styles";

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
          body: {
            fontFamily: "museo-sans, sans-serif",
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
        },
          variants:[  
          {
            props: {variant: "contained", color:"primary"},
            style:{
            backgroundColor: "#0082b5",
            color: "#ffffff",
            border: "1px solid #0082b5",
            "&:hover": {
              backgroundColor: "#035c7f",
              borderColor: "#035c7f",
            },
          },
        },
          {
            props: {variant: "contained", color:"primary"},
            style:{
            backgroundColor: "transparent",
            color: "#9fd1ef",
            border: "1px solid #9fd1ef",
            "&:hover": {
              backgroundColor: "transparent",
              borderColor: "#9fd1ef",
            },
          },
        },
      ]
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