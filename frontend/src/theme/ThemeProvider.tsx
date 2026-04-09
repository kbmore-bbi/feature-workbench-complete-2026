'use client';

import { ReactNode } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { CacheProvider } from '@emotion/react';
import { createEmotionCache } from '@/theme/emotionCache';
import theme from './theme';

const clientEmotionCache = createEmotionCache();

interface ThemeProviderProps {
  children: ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <CacheProvider value={clientEmotionCache}>
      <MuiThemeProvider  theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider >
    </CacheProvider>
  );
}