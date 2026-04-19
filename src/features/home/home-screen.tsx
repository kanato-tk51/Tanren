"use client";

import {
  BarChart3,
  ChevronRight,
  History,
  LineChart,
  ListChecks,
  LogOut,
  Map as MapIcon,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TIER_1_DOMAIN_IDS } from "@/db/schema";
import { cn } from "@/lib/cn";
import { DOMAIN_LABELS } from "@/lib/domain-labels";
import { trpc } from "@/lib/trpc/react";

export type InitialHomeUser = {
  id: string;
  email: string;
  displayName: string | null;
  dailyGoal: number;
} | null;

export function HomeScreen({ initialUser }: { initialUser: InitialHomeUser }) {
  const router = useRouter();
  const me = trpc.auth.me.useQuery(undefined, {
    initialData: initialUser
      ? { authenticated: true, user: initialUser }
      : { authenticated: false },
  });
  const utils = trpc.useUtils();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      await utils.auth.me.invalidate();
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  if (me.isError) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>読み込みに失敗しました</CardTitle>
          <CardDescription>tRPC / DB に到達できませんでした。</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm break-all">
          {me.error.message}
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={() => me.refetch()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            再試行
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!me.data || !me.data.authenticated) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Tanren
          </CardTitle>
          <CardDescription>エンジニアのための AI 家庭教師</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          このデバイスの Passkey でログインしてください。
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button asChild>
            <a href="/login">Passkey でログイン</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const { user } = me.data;
  return (
    <div className="w-full max-w-2xl space-y-4">
      <HomeHeader
        displayName={user.displayName ?? user.email}
        email={user.email}
        loggingOut={loggingOut}
        onLogout={handleLogout}
      />
      <DailyDrillCard dailyGoal={user.dailyGoal} />
      <ModeGrid />
      <DeepDiveSection />
      <InsightsSection />
    </div>
  );
}

function HomeHeader({
  displayName,
  email,
  loggingOut,
  onLogout,
}: {
  displayName: string;
  email: string;
  loggingOut: boolean;
  onLogout: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <h1 className="text-lg font-semibold">ようこそ、{displayName}</h1>
        <p className="text-muted-foreground text-xs">{email}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onLogout} disabled={loggingOut}>
        <LogOut className="mr-1 h-4 w-4" />
        {loggingOut ? "ログアウト中…" : "ログアウト"}
      </Button>
    </div>
  );
}

function DailyDrillCard({ dailyGoal }: { dailyGoal: number }) {
  const progress = trpc.home.dailyProgress.useQuery();
  const attemptCount = progress.data?.attemptCount ?? 0;
  const ratio = dailyGoal > 0 ? Math.min(attemptCount / dailyGoal, 1) : 0;
  // aria-valuenow は [0, dailyGoal] の範囲に clamp し、aria-valuetext で実数を補う
  // (目標超過日でも ARIA 仕様上の valuemin/valuemax を逸脱しないため)。
  const ariaValueNow = Math.min(attemptCount, dailyGoal);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" /> 今日の復習
        </CardTitle>
        <CardDescription>
          {progress.isError
            ? "今日の進捗を取得できませんでした"
            : progress.isLoading
              ? "進捗を読み込み中…"
              : `${attemptCount} / ${dailyGoal} 問 (JST 00:00 以降)`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="bg-secondary h-2 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={dailyGoal}
          aria-valuenow={ariaValueNow}
          aria-valuetext={`${attemptCount} / ${dailyGoal} 問`}
          aria-label="今日の進捗"
        >
          <div
            className="bg-primary h-full transition-[width]"
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild className="min-h-12 w-full">
          <Link href="/drill">
            <ListChecks className="mr-1 h-4 w-4" />
            Daily Drill を始める
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ModeGrid() {
  const modes: Array<{ href: string; icon: typeof ListChecks; label: string; desc: string }> = [
    {
      href: "/review",
      icon: RotateCcw,
      label: "Mistake Review",
      desc: "直近の誤答を再挑戦",
    },
    {
      href: "/custom",
      icon: Wand2,
      label: "Custom Session",
      desc: "条件指定で自由に出題",
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {modes.map((m) => {
        const Icon = m.icon;
        return (
          <Link
            key={m.href}
            href={m.href}
            className={cn(
              "hover:bg-accent/40 flex items-center gap-3 rounded-lg border p-4 transition-colors",
            )}
          >
            <Icon className="text-primary h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{m.label}</div>
              <div className="text-muted-foreground text-xs">{m.desc}</div>
            </div>
            <ChevronRight className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );
}

function DeepDiveSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Deep Dive</CardTitle>
        <CardDescription>1 ドメインを prereqs 順・難易度昇順で 10-15 問</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TIER_1_DOMAIN_IDS.map((d) => (
            <Button key={d} asChild variant="outline" className="justify-start">
              <Link href={`/deep/${d}`}>{DOMAIN_LABELS[d]}</Link>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function InsightsSection() {
  const links: Array<{ href: string; icon: typeof BarChart3; label: string }> = [
    { href: "/insights", icon: BarChart3, label: "Dashboard" },
    { href: "/insights/history", icon: History, label: "History" },
    { href: "/insights/search", icon: Search, label: "Search" },
    { href: "/insights/map", icon: MapIcon, label: "Mastery Map" },
    { href: "/insights/trends", icon: LineChart, label: "Trends" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Insights</CardTitle>
        <CardDescription>学習の進捗と弱点の可視化</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {links.map((l) => {
            const Icon = l.icon;
            return (
              <Button key={l.href} asChild variant="ghost" className="justify-start">
                <Link href={l.href}>
                  <Icon className="mr-1 h-4 w-4" aria-hidden="true" />
                  {l.label}
                </Link>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
