"use client";

import { Mail } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/react";

import { WebPushToggle } from "./web-push-toggle";

export function SettingsScreen() {
  const settings = trpc.settings.get.useQuery();
  const setWeekly = trpc.settings.setWeeklyDigestEnabled.useMutation();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  // 取得失敗 / ロード中は null を区別、誤操作を防ぐ (Codex Round 2 指摘 #2)
  const enabled = settings.data?.weeklyDigestEnabled ?? null;
  const canToggle = enabled !== null && !settings.isError;

  async function onToggle() {
    if (enabled === null) return;
    setError(null);
    try {
      await setWeekly.mutateAsync({ enabled: !enabled });
      await utils.settings.get.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "設定の更新に失敗しました");
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>設定</CardTitle>
        <CardDescription>通知とアカウント</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-medium">
              <Mail className="h-4 w-4" /> Weekly Digest
            </div>
            <div className="text-muted-foreground text-xs">
              毎週日曜 09:00 JST に先週の学習サマリをメール配信 (issue #36)
            </div>
          </div>
          <Button
            variant={enabled === true ? "default" : "outline"}
            size="sm"
            onClick={onToggle}
            disabled={!canToggle || setWeekly.isPending}
            aria-pressed={enabled === true}
          >
            {settings.isLoading ? "…" : enabled === true ? "ON" : "OFF"}
          </Button>
        </div>
        {settings.isError && (
          <p className="text-destructive text-xs">
            設定の読み込みに失敗しました: {settings.error.message}
          </p>
        )}
        {error && <p className="text-destructive text-xs">{error}</p>}
        <WebPushToggle />
        <p className="text-muted-foreground text-xs">
          二重配信抑止: Weekly Digest はメール専用、Daily reminder は Web Push 専用なので同じ通知は
          1 経路のみ配信されます。
        </p>
      </CardContent>
    </Card>
  );
}
