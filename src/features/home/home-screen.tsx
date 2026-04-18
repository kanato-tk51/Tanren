"use client";

import { LogOut, RefreshCw, Sparkles } from "lucide-react";
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
import { trpc } from "@/lib/trpc/react";

export type InitialHomeUser = {
  id: string;
  email: string;
  displayName: string | null;
  dailyGoal: number;
} | null;

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

  // tRPC / DB 障害と「ログアウト済み」を UI 上でも区別する
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
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>ようこそ、{user.displayName ?? user.email}</CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          1日の目標: <span className="font-medium">{user.dailyGoal} 問</span>
        </div>
        <div className="text-muted-foreground">
          Phase 0 bootstrap。Drill / Insights は別 issue で接続予定。
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={handleLogout} disabled={loggingOut}>
          <LogOut className="mr-1 h-4 w-4" />
          {loggingOut ? "ログアウト中…" : "ログアウト"}
        </Button>
      </CardFooter>
    </Card>
  );
}
