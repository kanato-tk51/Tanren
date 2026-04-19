"use client";

import { usePathname } from "next/navigation";

import { OfflineDrainer } from "@/features/offline/offline-drainer";
import { cn } from "@/lib/cn";

import { BottomNav } from "./bottom-nav";
import { isNavHidden, isPublicRoute } from "./nav-routes";
import { OfflineBanner } from "./offline-banner";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const navVisible = !isNavHidden(pathname);
  // OfflineDrainer は trpc.auth.me を fire するため、公開ページ (/login) で mount すると
  // React Query の cache に { authenticated: false } を seed してしまい、ログイン成功後の
  // HomeScreen の initialData が効かなくなる (Codex Round 2 指摘 #2)。
  const drainerMounted = !isPublicRoute(pathname);
  return (
    <>
      <OfflineBanner />
      {drainerMounted && <OfflineDrainer />}
      <div className={cn("flex flex-1 flex-col", navVisible && "pb-16 md:pb-0")}>{children}</div>
      {navVisible && <BottomNav />}
    </>
  );
}
