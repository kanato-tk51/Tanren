"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { Search as SearchIcon } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/react";

import type { AppRouter } from "@/server/trpc/routers";

type Hit = inferRouterOutputs<AppRouter>["insights"]["search"]["hits"][number];

const HIT_SOURCE_LABEL: Record<Hit["hitSource"], string> = {
  question: "問題文",
  userAnswer: "あなたの回答",
  feedback: "フィードバック",
  misconception: "誤概念",
};

/**
 * 簡易全文検索 (issue #22, docs/05 §5.6)。
 * nuqs で ?q=... を URL 同期。送信ボタンで初めて検索を走らせる (onChange 都度は重いので)。
 */
export function SearchScreen() {
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [input, setInput] = useState(q ?? "");

  const query = trpc.insights.search.useQuery(
    { q: q ?? "", limit: 50 },
    { enabled: (q ?? "").trim().length > 0 },
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void setQ(input.trim() || null);
  };

  return (
    <div className="w-full max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>検索</CardTitle>
          <CardDescription>
            過去の問題文 / 自分の回答 / フィードバック / 誤概念から部分一致検索。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例: race condition"
              className="border-input bg-background min-w-0 flex-1 rounded-md border px-2 py-1 text-sm"
              maxLength={200}
            />
            <Button type="submit" size="sm">
              <SearchIcon className="mr-1 h-3.5 w-3.5" />
              検索
            </Button>
          </form>
        </CardContent>
      </Card>

      {(q ?? "").trim().length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">
            検索語を入力してください。
          </CardContent>
        </Card>
      ) : query.isLoading ? (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">検索中...</CardContent>
        </Card>
      ) : query.error ? (
        <Card>
          <CardContent className="text-destructive p-6 text-sm">{query.error.message}</CardContent>
        </Card>
      ) : query.data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Hit 集計 ({query.data.hits.length} 件)</CardTitle>
            </CardHeader>
            <CardContent>
              {query.data.domainHits.length === 0 ? (
                <div className="text-muted-foreground text-sm">該当なし。</div>
              ) : (
                <ul className="space-y-1 text-sm">
                  {query.data.domainHits.map((d) => (
                    <li key={d.domainId}>
                      {d.domainId}: <span className="font-mono">{d.count}</span> 件
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {query.data.hits.length === 0 ? null : (
            <ul className="space-y-2">
              {query.data.hits.map((hit) => (
                <HitRow key={hit.attemptId} hit={hit} q={q ?? ""} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

function HitRow({ hit, q }: { hit: Hit; q: string }) {
  const created = new Date(hit.createdAt);
  return (
    <li className="border-border rounded-md border p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {created.toLocaleString("ja-JP")}
        </span>
        <span className="text-muted-foreground text-xs">{HIT_SOURCE_LABEL[hit.hitSource]}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap">
        <Highlight text={hit.questionPrompt} q={q} />
      </div>
      <div className="text-muted-foreground mt-1 text-xs">
        {hit.domainId} / {hit.subdomainId} ・ {hit.conceptName}
      </div>
      {hit.userAnswer && hit.hitSource === "userAnswer" && (
        <div className="bg-muted/40 mt-2 rounded p-2 text-xs">
          <Highlight text={hit.userAnswer} q={q} />
        </div>
      )}
      {hit.feedback && hit.hitSource === "feedback" && (
        <div className="bg-muted/40 mt-2 rounded p-2 text-xs">
          <Highlight text={hit.feedback} q={q} />
        </div>
      )}
    </li>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-900">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}
