"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { BottomNav } from "./bottom-nav";
import { isNavHidden } from "./nav-routes";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const navVisible = !isNavHidden(pathname);
  return (
    <>
      <div className={cn("flex flex-1 flex-col", navVisible && "pb-16 md:pb-0")}>{children}</div>
      {navVisible && <BottomNav />}
    </>
  );
}
