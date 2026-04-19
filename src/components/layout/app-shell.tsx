"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { BottomNav } from "./bottom-nav";
import { isNavHidden } from "./nav-routes";
import { OfflineBanner } from "./offline-banner";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const navVisible = !isNavHidden(pathname);
  return (
    <>
      <OfflineBanner />
      <div className={cn("flex flex-1 flex-col", navVisible && "pb-16 md:pb-0")}>{children}</div>
      {navVisible && <BottomNav />}
    </>
  );
}
