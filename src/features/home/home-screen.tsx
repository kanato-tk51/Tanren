"use client";

import { LogOut, RefreshCw, Sparkles } from "lucide-react";
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
import { OfflineDrainer } from "@/features/offline/offline-drainer";
import { DOMAIN_LABELS } from "@/lib/domain-labels";
import { trpc } from "@/lib/trpc/react";

export type InitialHomeUser = {
  id: string;
  /** GitHub OAuth 移行 (ADR-0006) で email は任意に。表示には github_login / displayName を優先使用。 */
  email: string | null;
  displayName: string | null;
  githubLogin: string | null;
  dailyGoal: number;
} | null;

function NavCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="focus-visible:ring-ring rounded-md focus:outline-none focus-visible:ring-2"
    >
      <Card className="hover:bg-accent/50 h-full transition-colors">
        <CardHeader className="p-4">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="text-xs">{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

export function HomeScreen({ initialUser }: { initialUser: InitialHomeUser }) {
  const router = useRouter();
  // SSR で解決した initialUser を初期値にしておき、以後はクライアント側で再検証
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

  // tRPC / DB 障害と「ログアウト済み」を UI 上でも区別する。`my-auto` は flex-col の
  // 親 (page.tsx の main) で縦方向に中央寄せする (Codex PR#85 Round 3 指摘 #1)。
  if (me.isError) {
    return (
      <Card className="my-auto w-full max-w-md">
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
      <Card className="my-auto w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Tanren
          </CardTitle>
          <CardDescription>エンジニアのための AI 家庭教師</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          GitHub アカウントでログインしてください。
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button asChild>
            <a href="/login">GitHub でログイン</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const { user } = me.data;
  return (
    <>
      {/* OfflineDrainer を authenticated エントリ画面で mount する。root layout に置くと
          /login など公開ルートでも auth 解決の責務が発生するため (Codex PR #84 Round 4)、
          既に user を知っている HomeScreen 内に閉じる。 */}
      <OfflineDrainer userId={user.id} />
      <div className="w-full max-w-4xl space-y-6">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">
              ようこそ、{user.displayName ?? user.githubLogin ?? user.email ?? "ユーザー"}
            </h1>
            <p className="text-muted-foreground text-sm">
              1日の目標: <span className="font-medium">{user.dailyGoal} 問</span>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut}>
            <LogOut className="mr-1 h-4 w-4" />
            {loggingOut ? "ログアウト中…" : "ログアウト"}
          </Button>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">学習を始める</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NavCard href="/drill" title="Daily Drill" description="今日の目標まで 1 問ずつ" />
            <NavCard href="/review" title="Mistake Review" description="間違えた問題を再挑戦" />
            <NavCard href="/custom" title="Custom Session" description="自然文で狙い撃ち出題" />
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Insights</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NavCard href="/insights" title="Dashboard" description="概要と最新サマリ" />
            <NavCard href="/insights/history" title="History" description="過去セッション一覧" />
            <NavCard href="/insights/search" title="Search" description="全文検索" />
            <NavCard href="/insights/map" title="Mastery Map" description="習熟度を可視化" />
            <NavCard href="/insights/trends" title="Trends" description="推移を追う" />
            <NavCard
              href="/insights/misconceptions"
              title="Misconceptions"
              description="誤概念を整理"
            />
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Deep Dive</h2>
          <p className="text-muted-foreground text-xs">1 ドメインに集中して 10-15 問</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TIER_1_DOMAIN_IDS.map((d) => (
              <NavCard
                key={d}
                href={`/deep/${d}`}
                title={DOMAIN_LABELS[d]}
                description="集中出題"
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
