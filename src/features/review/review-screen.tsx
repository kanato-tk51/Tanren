"use client";

import { AlertTriangle, ArrowRight, Loader2, RotateCcw } from "lucide-react";
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
import { DrillScreen } from "@/features/drill/drill-screen";
import { useDrillStore } from "@/features/drill/drill-state";
import { trpc } from "@/lib/trpc/react";

type Phase = { kind: "idle" } | { kind: "running"; sessionId: string };

/**
 * Mistake Review モード (issue #23, docs/02 §2.6)。
 * 直近 14 日の誤答 concept から 10-15 問を選定して Drill 画面で出題する。
 */
export function ReviewScreen() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const startMutation = trpc.session.start.useMutation();
  const nextMutation = trpc.session.next.useMutation();
  const { reset, setSession, setQuestion } = useDrillStore();

  const onStart = useCallback(async () => {
    setError(null);
    reset();
    try {
      const { sessionId } = await startMutation.mutateAsync({ kind: "review" });
      try {
        const next = await nextMutation.mutateAsync({ sessionId });
        setSession(sessionId);
        setPhase({ kind: "running", sessionId });
        if (!next.done) setQuestion(next.question);
      } catch (e) {
        setError(e instanceof Error ? e.message : "問題の生成に失敗しました");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "セッション開始に失敗しました");
    }
  }, [startMutation, nextMutation, reset, setSession, setQuestion]);

  const backToIdle = useCallback(() => {
    reset();
    setError(null);
    setPhase({ kind: "idle" });
  }, [reset]);

  if (phase.kind === "running") {
    return <DrillScreen onReset={backToIdle} skipInitialStartCard />;
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>
          <RotateCcw className="mr-1 inline h-5 w-5" />
          Mistake Review
        </CardTitle>
        <CardDescription>
          直近 14 日間で誤答した concept を 10-15 問にわたって復習します。
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm">
        <p>
          concept ごとに最新の誤答 1 件ずつを候補化し、Drill 画面で解きます。候補が 10
          件未満のときは同じ concept を別の問題で繰り返し出題して 10-15 問の
          枠を埋めます。誤答した分野の「叩き直し」に使ってください。
        </p>
        {error && (
          <div className="text-destructive flex items-start gap-1 text-xs">
            <AlertTriangle className="mt-0.5 h-3 w-3" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button onClick={onStart} disabled={startMutation.isPending || nextMutation.isPending}>
          {(startMutation.isPending || nextMutation.isPending) && (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          )}
          Review を始める
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
