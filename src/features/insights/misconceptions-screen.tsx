"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { Check, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/react";
import type { AppRouter } from "@/server/trpc/routers";

type Misconceptions = inferRouterOutputs<AppRouter>["insights"]["misconceptions"];
type Item = Misconceptions["active"][number];

function ItemRow({
  item,
  onResolve,
  resolving,
}: {
  item: Item;
  onResolve?: (id: string) => void;
  resolving?: boolean;
}) {
  // 矯正 Custom Session への導線 (docs/05 §5.8 「矯正指示入り」)。
  // /custom は ?prefill= を受け取る (src/app/custom/page.tsx)。conceptId が指定されると
  // 既存実装では LLM parser を迂回して questionCount=5 の固定 spec になる (custom-screen.tsx)。
  // MVP ではこの挙動を受け入れ、prefill は「どんな矯正を意図していたか」を textarea に
  // 残すための表示用テキストとして扱う。実際の矯正指示を生成プロンプトに注入するには
  // custom-session parser / generator の拡張が必要で、それは別 issue のスコープ。
  // (Codex Round 1 指摘 #1: raw → prefill に修正、param 名が実装と一致)。
  const prefill = `concept ${item.conceptId} について ${item.description} という誤解を矯正する問題を 3 問`;
  const customHref =
    `/custom?conceptId=${encodeURIComponent(item.conceptId)}` +
    `&prefill=${encodeURIComponent(prefill)}`;
  return (
    <li className="border-border space-y-2 rounded-md border p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-medium">{item.description}</div>
        <span className="text-muted-foreground shrink-0 font-mono text-xs">×{item.count}</span>
      </div>
      <div className="text-muted-foreground text-xs">
        {item.domainId} / {item.subdomainId} ・ {item.conceptName}
      </div>
      <div className="text-muted-foreground text-xs">
        初回: {new Date(item.firstSeen).toLocaleDateString("ja-JP")} ・ 最終:{" "}
        {new Date(item.lastSeen).toLocaleDateString("ja-JP")}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={customHref}>
            <Sparkles className="mr-1 h-3 w-3" />
            矯正用問題を出す
          </Link>
        </Button>
        {onResolve && (
          <Button variant="ghost" size="sm" onClick={() => onResolve(item.id)} disabled={resolving}>
            <Check className="mr-1 h-3 w-3" />
            解決済みにする
          </Button>
        )}
      </div>
    </li>
  );
}

export function MisconceptionsScreen() {
  const { data, isLoading, error, refetch } = trpc.insights.misconceptions.useQuery();
  const resolveMut = trpc.insights.resolveMisconception.useMutation();
  const utils = trpc.useUtils();
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function onResolve(id: string) {
    setErrMsg(null);
    try {
      await resolveMut.mutateAsync({ id });
      await utils.insights.misconceptions.invalidate();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "解決マークに失敗しました");
    }
  }

  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl">
        <CardContent className="text-muted-foreground p-6 text-sm">読み込み中…</CardContent>
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
          <CardTitle>Misconception Tracker</CardTitle>
          <CardDescription>
            繰り返す誤概念を count 降順で一覧。矯正問題で重点的に解くと resolved に遷移します (連続
            3 正答で自動解決、または手動解決)。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3 w-3" /> 更新
            </Button>
          </div>
          {errMsg && <div className="text-destructive text-xs">{errMsg}</div>}
          {data.active.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              追跡中の誤概念はありません。調子いい!
            </div>
          ) : (
            <ul className="space-y-2">
              {data.active.map((i) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  onResolve={onResolve}
                  resolving={resolveMut.isPending}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {data.resolved.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">✅ 解決済み ({data.resolved.length})</CardTitle>
            <CardDescription>
              3 連続正答 または手動で解決済みにした誤概念。再発したら自動で active に戻ります。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 opacity-70">
              {data.resolved.map((i) => (
                <ItemRow key={i.id} item={i} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="text-muted-foreground text-xs">
        <Link href="/insights" className="underline">
          ← Dashboard に戻る
        </Link>
      </div>
    </div>
  );
}
