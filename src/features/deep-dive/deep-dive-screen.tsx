"use client";

import { AlertTriangle, Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DomainId } from "@/db/schema";
import { DrillScreen } from "@/features/drill/drill-screen";
import { useDrillStore } from "@/features/drill/drill-state";
import { DOMAIN_LABELS } from "@/lib/domain-labels";
import { trpc } from "@/lib/trpc/react";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; sessionId: string }
  | { kind: "error"; message: string };

/**
 * Deep Dive セッション画面 (issue #28)。
 * 1 ドメインを prereqs トポロジカルソート → difficulty 昇順で 10-15 問出題。
 *
 * 起動フロー:
 *   - /deep/:domain でこの画面を表示
 *   - idle: スタートカード (ドメイン名 + 「集中出題を始める」)
 *   - 開始ボタン → session.start({kind:'deep', domainId}) → session.next → running
 *   - running: DrillScreen を skipInitialStartCard で埋め込み
 *   - 完了後「ホームに戻る」で /insights に遷移 (元の導線 Weakest カードに戻る想定)
 */
export function DeepDiveScreen({ domainId }: { domainId: DomainId }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const startSession = trpc.session.start.useMutation();
  const nextQuestion = trpc.session.next.useMutation();
  const { reset, setSession, setQuestion } = useDrillStore();

  const onStart = useCallback(async () => {
    try {
      reset();
      const { sessionId } = await startSession.mutateAsync({ kind: "deep", domainId });
      const next = await nextQuestion.mutateAsync({ sessionId });
      setSession(sessionId);
      setPhase({ kind: "running", sessionId });
      if (!next.done) setQuestion(next.question);
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "Deep Dive の開始に失敗しました",
      });
    }
  }, [domainId, reset, startSession, nextQuestion, setSession, setQuestion]);

  if (phase.kind === "running") {
    return (
      <DrillScreen
        onReset={() => {
          // 完了後は Insights (元の導線 Weakest カードの画面) に戻す
          router.push("/insights");
        }}
        skipInitialStartCard
      />
    );
  }

  const pending = startSession.isPending || nextQuestion.isPending;
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Deep Dive: {DOMAIN_LABELS[domainId] ?? domainId}</CardTitle>
        <CardDescription>
          {DOMAIN_LABELS[domainId] ?? domainId} の concept を prereqs 順・難易度昇順で 10-15
          問解きます。
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm">
        <p>1 ドメイン集中 30 分前後のセッションです。</p>
        {phase.kind === "error" && (
          <div className="text-destructive flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span className="break-all">{phase.message}</span>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={onStart} disabled={pending} className="min-h-12 w-full px-6">
          {pending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          集中出題を始める
        </Button>
      </CardFooter>
    </Card>
  );
}
