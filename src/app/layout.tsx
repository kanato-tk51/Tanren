import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { AppShell } from "@/components/layout/app-shell";
import { RegisterServiceWorker } from "@/features/pwa/register-sw";
import { TrpcProvider } from "@/lib/trpc/react";
import { getCurrentUser } from "@/server/auth/session";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tanren",
  description: "エンジニアのための AI 家庭教師",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tanren",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // OfflineDrainer が auth.me を shared cache に seed してしまう回帰を避けるため、
  // 認証状態を server 側で確定して client に渡す (Codex Round 3 指摘)。
  // getCurrentUser は React.cache で dedup されるので、page.tsx で別途呼んでも DB
  // round-trip は 1 回のみ。
  const initialUser = await getCurrentUser();
  return (
    <html lang="ja" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <RegisterServiceWorker />
        <NuqsAdapter>
          <TrpcProvider>
            <AppShell initialUserId={initialUser?.id ?? null}>{children}</AppShell>
          </TrpcProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
