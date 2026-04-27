"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { getAppTheme, type AppThemeMode } from "@/theme/theme";

type ThemeModeContextValue = {
  mode: AppThemeMode;
  toggleMode: () => void;
  setMode: (mode: AppThemeMode) => void;
};

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function useThemeMode() {
  const context = useContext(ThemeModeContext);

  if (!context) {
    throw new Error("useThemeMode must be used inside Providers");
  }

  return context;
}

export default function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AppThemeMode>("light");

  useEffect(() => {
    const savedMode = window.localStorage.getItem("theme-mode") as AppThemeMode | null;

    if (savedMode === "light" || savedMode === "dark") {
      setMode(savedMode);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    window.localStorage.setItem("theme-mode", mode);
  }, [mode]);

  const theme = useMemo(() => getAppTheme(mode), [mode]);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      toggleMode: () => {
        setMode((prev) => (prev === "light" ? "dark" : "light"));
      },
    }),
    [mode]
  );

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

