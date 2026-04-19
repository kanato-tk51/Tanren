"use client";

import { usePathname } from "next/navigation";

import { OfflineDrainer } from "@/features/offline/offline-drainer";
import { cn } from "@/lib/cn";

import { BottomNav } from "./bottom-nav";
import { isNavHidden } from "./nav-routes";
import { OfflineBanner } from "./offline-banner";

/** initialUserId は server が getCurrentUser() で解決した値。null なら未ログイン扱いで
 *  OfflineDrainer を mount しない (auth.me 経由の shared React Query cache 汚染を避ける、
 *  Codex Round 3 指摘)。 */
export function AppShell({
  children,
  initialUserId,
}: {
  children: React.ReactNode;
  initialUserId: string | null;
}) {
  const pathname = usePathname() ?? "/";
  const navVisible = !isNavHidden(pathname);
  return (
    <>
      <OfflineBanner />
      {initialUserId !== null && <OfflineDrainer userId={initialUserId} />}
      <div className={cn("flex flex-1 flex-col", navVisible && "pb-16 md:pb-0")}>{children}</div>
      {navVisible && <BottomNav />}
    </>
  );
}
