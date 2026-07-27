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
import { Provider as ReduxProvider } from "react-redux";
import { store } from "@/store/store";
import { GlobalErrorProvider } from "@/components/error/global-error-provider";
import { AppSidebarProvider } from "@/features/layout/app-sidebar-context";
import { AiChatLayoutProvider } from "@/features/ai-agent/ai-chat-layout-context";
import { SttmBuilderProvider } from "@/features/sttm/context/sttm-builder-context";
import { TourOverlay, TourProvider } from "@/features/tour/engine";

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
      <ReduxProvider store={store}>
        <TourProvider>
          <SttmBuilderProvider>
            <AiChatLayoutProvider>
              <ThemeProvider theme={theme}>
                <CssBaseline />
                <GlobalErrorProvider>
                  <AppSidebarProvider>
                    {children}
                    <TourOverlay />
                  </AppSidebarProvider>
                </GlobalErrorProvider>
              </ThemeProvider>
            </AiChatLayoutProvider>
          </SttmBuilderProvider>
        </TourProvider>
      </ReduxProvider>
    </ThemeModeContext.Provider>
  );
}
