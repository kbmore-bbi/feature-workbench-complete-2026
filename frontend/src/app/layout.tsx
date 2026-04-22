import type { Metadata } from "next";
import "./globals.css";
import '@/theme/theme.css';
import ThemeProvider from '@/theme/ThemeProvider';
import ChatWidget from '@/features/ai-agent/ChatWidget';

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
        <ThemeProvider>
          {children}
          <ChatWidget /> 
        </ThemeProvider>
      </body>
    </html>

  );
}
