"use client";

import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/react";

import type { AppRouter } from "@/server/trpc/routers";

// Server 側の OverviewItem 型から推論して client 再定義の二重管理を避ける (Round 4 指摘 #2)。
type InsightsOverview = inferRouterOutputs<AppRouter>["insights"]["overview"];
type OverviewItem = InsightsOverview["strongest"][number];

function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const filled = Math.round(value * 20);
  return (
    <div className="space-y-1">
      <div className="font-mono text-xs">
        {"▓".repeat(filled)}
        <span className="text-muted-foreground">{"░".repeat(20 - filled)}</span>
        {"  "}
        {pct}%
      </div>
    </div>
  );
}

function ItemRow({
  item,
  hint,
  showDeepDive,
}: {
  item: OverviewItem;
  hint: (it: OverviewItem) => string | null;
  /** Weakest カード等で「このドメインを Deep Dive」導線を出すかどうか (issue #28) */
  showDeepDive?: boolean;
}) {
  const message = hint(item);
  // /custom?conceptId=... に直接 conceptId を渡し、parser を迂回して customSpec.concepts を
  // 決定論的に固定する (Round 3 指摘 #1: 自然言語 prefill では別 concept に解釈されうる)。
  const customHref = `/custom?conceptId=${encodeURIComponent(item.conceptId)}`;
  // Insights 発の Deep Dive は完了後 /insights に戻して Weakest カードの更新を見せたい。
  // Home 発 (/ default) とは別挙動なので `?returnTo=/insights` を明示付与。
  const deepHref = `/deep/${encodeURIComponent(item.domainId)}?returnTo=%2Finsights`;
  return (
    <li className="border-border rounded-md border p-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{item.conceptName}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {Math.round(item.masteryPct * 100)}%
        </span>
      </div>
      {message && <div className="text-muted-foreground mt-1 text-xs">{message}</div>}
      <div className="text-muted-foreground mt-1 text-xs">
        {item.domainId} / {item.subdomainId} ・ {item.conceptId}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={customHref}>🎯 この concept を出題</Link>
        </Button>
        {showDeepDive && (
          <Button asChild variant="outline" size="sm">
            <Link href={deepHref}>🏊 {item.domainId} を Deep Dive</Link>
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Insights Dashboard (issue #20, docs/05 §5.3)。
 * MVP は数値のみ + 簡易プログレスバー (Recharts なし)。
 * 各 Top 3 項目からは concept を強調した custom session への導線を置ける (Phase 2+)。
 */
export function InsightsOverviewScreen() {
  const { data, isLoading, error } = trpc.insights.overview.useQuery();

  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl">
        <CardContent className="text-muted-foreground p-6 text-sm">読み込み中...</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full max-w-2xl">
        <CardContent className="text-destructive p-6 text-sm">{error.message}</CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="w-full max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Your Learning, Today</CardTitle>
          <CardDescription>
            Mastery: {data.masteredConcepts} / {data.totalConcepts} concepts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProgressBar value={data.masteryPct} />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/insights/map">🗺 Mastery Map</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/insights/trends">📈 Trends</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/insights/misconceptions">💭 Misconceptions</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>📈 Strongest (top 3)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.strongest.length === 0 ? (
            <div className="text-muted-foreground text-sm">まだ十分な attempt がありません。</div>
          ) : (
            <ul className="space-y-2">
              {data.strongest.map((i) => (
                <ItemRow key={i.conceptId} item={i} hint={() => null} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>⚠️ Weakest (top 3)</CardTitle>
          <CardDescription>
            5 attempt 以上で mastery &lt; 50% の concept。改善対象。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.weakest.length === 0 ? (
            <div className="text-muted-foreground text-sm">該当なし。調子いい!</div>
          ) : (
            <ul className="space-y-2">
              {data.weakest.map((i) => (
                <ItemRow
                  key={i.conceptId}
                  item={i}
                  hint={(it) =>
                    it.attemptCount > 0 && it.wrongCount > 0
                      ? `${it.attemptCount} 問中 ${it.wrongCount} 問ミス (全期間)`
                      : null
                  }
                  showDeepDive
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>🚧 Blind Spots (未着手 top 3)</CardTitle>
          <CardDescription>
            prereqs を満たしているのにまだ一度も解いていない concept。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.blindSpots.length === 0 ? (
            <div className="text-muted-foreground text-sm">全て着手済み。</div>
          ) : (
            <ul className="space-y-2">
              {data.blindSpots.map((i) => (
                <ItemRow key={i.conceptId} item={i} hint={() => "0 問"} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>📉 Decaying (忘却進行中 top 3)</CardTitle>
          <CardDescription>
            1 週間以上レビューしていない mastery &lt; 80% の concept。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.decaying.length === 0 ? (
            <div className="text-muted-foreground text-sm">該当なし。</div>
          ) : (
            <ul className="space-y-2">
              {data.decaying.map((i) => (
                <ItemRow key={i.conceptId} item={i} hint={() => null} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link href="/custom">🎯 苦手を絞って出題</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/drill">🎲 Daily Drill</Link>
        </Button>
      </div>
    </div>
  );
}
