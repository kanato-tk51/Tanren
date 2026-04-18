"use client";

import { BarChart3, Home, ListChecks } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { activeTabId, NAV_TABS, type NavTabId } from "./nav-routes";

const ICONS: Record<NavTabId, typeof Home> = {
  home: Home,
  drill: ListChecks,
  insights: BarChart3,
};

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const activeId = activeTabId(pathname);
  return (
    <nav
      aria-label="主要ナビゲーション"
      className="bg-background fixed inset-x-0 bottom-0 z-50 grid grid-cols-3 border-t md:hidden"
    >
      {NAV_TABS.map((tab) => {
        const Icon = ICONS[tab.id];
        const active = tab.id === activeId;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
