import type { Metadata } from "next";
import "./globals.css";
import '@/theme/theme.css';
import Providers from "./Providers";
import AppHeader from "@/features/layout/app-header";
import ChatWidget from '@/features/ai-agent/chat-widget';
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
          <AppHeader />
          {children}
        </Providers>
      </body>
    </html>

  );
}
