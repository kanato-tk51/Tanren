"use client";

import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DOMAIN_IDS, type DomainId } from "@/db/schema/_constants";
import { trpc } from "@/lib/trpc/react";

import type { AppRouter } from "@/server/trpc/routers";

type HistoryItem = inferRouterOutputs<AppRouter>["insights"]["history"]["items"][number];

const PERIOD_VALUES = ["all", "today", "week"] as const;
const CORRECTNESS_VALUES = ["all", "correct", "wrong"] as const;

/**
 * History 画面 (issue #21, docs/05 §5.5)。
 * nuqs で URL クエリと state を同期 (`?period=week&correctness=wrong&domain=network` 等)。
 * 「もっと読み込む」で cursor pagination。
 */
export function HistoryScreen() {
  const [period, setPeriod] = useQueryState(
    "period",
    parseAsStringLiteral(PERIOD_VALUES).withDefault("all"),
  );
  const [correctness, setCorrectness] = useQueryState(
    "correctness",
    parseAsStringLiteral(CORRECTNESS_VALUES).withDefault("all"),
  );
  const [domainRaw, setDomainRaw] = useQueryState("domain", parseAsString.withDefault(""));
  const domain = DOMAIN_IDS.includes(domainRaw as DomainId) ? (domainRaw as DomainId) : "";

  const query = trpc.insights.history.useInfiniteQuery(
    {
      period,
      correctness,
      domains: domain ? [domain] : undefined,
      limit: 20,
    },
    {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    },
  );

  const items: HistoryItem[] = (query.data?.pages ?? []).flatMap((p) => p.items);

  return (
    <div className="w-full max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>解答履歴</CardTitle>
          <CardDescription>過去の attempt を時系列で閲覧。URL に状態が反映される。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <select
              value={period}
              onChange={(e) => void setPeriod(e.target.value as (typeof PERIOD_VALUES)[number])}
              className="border-input bg-background rounded-md border px-2 py-1"
            >
              <option value="all">全期間</option>
              <option value="today">今日</option>
              <option value="week">今週</option>
            </select>
            <select
              value={correctness}
              onChange={(e) =>
                void setCorrectness(e.target.value as (typeof CORRECTNESS_VALUES)[number])
              }
              className="border-input bg-background rounded-md border px-2 py-1"
            >
              <option value="all">正誤すべて</option>
              <option value="correct">正解のみ</option>
              <option value="wrong">誤答のみ</option>
            </select>
            <select
              value={domain}
              onChange={(e) => void setDomainRaw(e.target.value)}
              className="border-input bg-background rounded-md border px-2 py-1"
            >
              <option value="">分野すべて</option>
              {DOMAIN_IDS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">読み込み中...</CardContent>
        </Card>
      ) : query.error ? (
        <Card>
          <CardContent className="text-destructive p-6 text-sm">{query.error.message}</CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">
            該当する履歴がありません。
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <HistoryRow key={item.attemptId} item={item} />
          ))}
        </ul>
      )}

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? "読み込み中..." : "もっと読み込む"}
          </Button>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const correctLabel =
    item.correct === true ? "○ 正解" : item.correct === false ? "× 不正解" : "判定なし";
  const correctClass =
    item.correct === true
      ? "text-emerald-600"
      : item.correct === false
        ? "text-destructive"
        : "text-muted-foreground";
  const created = new Date(item.createdAt);
  // 「類題を出す」は concept を絞った Custom Session へ
  const customHref = `/custom?conceptId=${encodeURIComponent(item.conceptId)}`;
  return (
    <li className="border-border rounded-md border p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {created.toLocaleString("ja-JP")}
        </span>
        <span className={`font-medium ${correctClass}`}>{correctLabel}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap">{item.questionPrompt}</div>
      <div className="text-muted-foreground mt-1 text-xs">
        {item.domainId} / {item.subdomainId} ・ {item.conceptName} ・ {item.questionType} ・{" "}
        {item.difficulty}
      </div>
      {item.userAnswer && (
        <div className="bg-muted/40 mt-2 rounded p-2 text-xs">
          <span className="text-muted-foreground">あなたの回答: </span>
          <span>{item.userAnswer}</span>
        </div>
      )}
      {item.feedback && (
        <div className="mt-1 text-xs">
          <span className="text-muted-foreground">フィードバック: </span>
          <span>{item.feedback}</span>
        </div>
      )}
      <div className="mt-2">
        <Button asChild variant="outline" size="sm">
          <Link href={customHref}>🎯 類題を出す</Link>
        </Button>
      </div>
    </li>
  );
}
