import type { Metadata } from "next";
import "./globals.css";
import '@/theme/theme.css';
import Providers from "./Providers";
import AppHeader from "@/features/layout/app-header";
import AppShellGate from "@/features/layout/app-shell-gate";
import { CLIENT_CONFIG as config } from '@/config/client.config';

export const metadata: Metadata = {
  title: config.app.title,
  description: config.app.description,
  icons: {
    icon: config.branding.logo.favicon,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="emotion-insertion-point" content="" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <div className="flex h-screen flex-col overflow-hidden">
            <AppHeader />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <AppShellGate>{children}</AppShellGate>
            </div>
          </div>
        </Providers>
      </body>
    </html>

  );
}
