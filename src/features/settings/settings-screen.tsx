"use client";

import { Mail } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/react";

export function SettingsScreen() {
  const settings = trpc.settings.get.useQuery();
  const setWeekly = trpc.settings.setWeeklyDigestEnabled.useMutation();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const enabled = settings.data?.weeklyDigestEnabled ?? true;

  async function onToggle() {
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
            variant={enabled ? "default" : "outline"}
            size="sm"
            onClick={onToggle}
            disabled={settings.isLoading || setWeekly.isPending}
            aria-pressed={enabled}
          >
            {enabled ? "ON" : "OFF"}
          </Button>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </CardContent>
    </Card>
  );
}
