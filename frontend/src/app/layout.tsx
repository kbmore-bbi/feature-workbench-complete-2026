import type { Metadata } from "next";
import "./globals.css";
import '@/theme/theme.css';
import ThemeProvider from '@/theme/ThemeProvider';
import Providers from "./Providers";
import ChatWidget from '@/features/ai-agent/chat-widget';
import AppHeader from "@/features/layout/app-header";

export const metadata: Metadata = {
  title: "Focus AI Migration Workbench",
  description: "Data management platform powered by BBI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="emotion-insertion-point" content="" />
      </head>
      <body>
        <Providers>
          <AppHeader />
          {children}
          <ChatWidget />
        </Providers>
      </body>
    </html>

  );
}
