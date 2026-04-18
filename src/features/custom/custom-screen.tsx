"use client";

import { AlertTriangle, ArrowRight, Loader2, Sparkles, Undo2 } from "lucide-react";
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

import type { CustomSessionSpec } from "@/server/parser/schema";

type Phase =
  | { kind: "input" }
  | { kind: "previewing"; raw: string; spec: CustomSessionSpec }
  | { kind: "running"; sessionId: string };

/**
 * Custom Session 実行フロー (issue #18)。
 * 1. 自然言語入力 → custom.parse → 読み取り専用カード
 * 2. 違うと判断したら raw を修正して再パース (MVP は編集フォームなし)
 * 3. 開始ボタン → session.start({kind:"custom", spec}) → useDrillStore に流し込み → DrillScreen
 */
export function CustomScreen() {
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parseMutation = trpc.custom.parse.useMutation();
  const startMutation = trpc.session.start.useMutation();
  const nextMutation = trpc.session.next.useMutation();
  const { reset, setSession, setQuestion } = useDrillStore();

  const onParse = useCallback(async () => {
    setError(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setError("内容を入力してください");
      return;
    }
    try {
      const { spec } = await parseMutation.mutateAsync({ raw: trimmed });
      setPhase({ kind: "previewing", raw: trimmed, spec });
    } catch (e) {
      setError(e instanceof Error ? e.message : "パースに失敗しました");
    }
  }, [parseMutation, raw]);

  const onStart = useCallback(async () => {
    if (phase.kind !== "previewing") return;
    setError(null);
    try {
      reset();
      const { sessionId } = await startMutation.mutateAsync({
        kind: "custom",
        customSpec: phase.spec,
      });
      // setSession を next の前に実行しておき、next 失敗時でも同じセッションを
      // 再試行できる状態に保つ (孤立セッション回避)。
      setSession(sessionId);
      setPhase({ kind: "running", sessionId });
      const next = await nextMutation.mutateAsync({ sessionId });
      if (!next.done) setQuestion(next.question);
    } catch (e) {
      setError(e instanceof Error ? e.message : "セッション開始に失敗しました");
    }
  }, [phase, startMutation, nextMutation, setSession, setQuestion, reset]);

  const backToInput = useCallback(() => {
    reset();
    setError(null);
    setPhase({ kind: "input" });
  }, [reset]);

  if (phase.kind === "running") {
    return <DrillScreen onReset={backToInput} skipInitialStartCard />;
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Custom Session</CardTitle>
        <CardDescription>自然言語で「こんな問題出して」と指定します。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="例: 面接レベルで、TCP の輻輳制御について 5 問、なぜそうなっているかを問う"
          rows={4}
          maxLength={2000}
          className="border-input bg-background w-full rounded-md border p-2 text-sm"
          disabled={phase.kind === "previewing"}
        />
        {phase.kind === "previewing" && <SpecPreview spec={phase.spec} />}
        {error && (
          <div className="text-destructive flex items-start gap-1 text-xs">
            <AlertTriangle className="mt-0.5 h-3 w-3" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        {phase.kind === "input" ? (
          <Button onClick={onParse} disabled={parseMutation.isPending}>
            {parseMutation.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            解釈する
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setError(null);
                setPhase({ kind: "input" });
              }}
            >
              <Undo2 className="mr-1 h-4 w-4" />
              違う、入力を直す
            </Button>
            <Button onClick={onStart} disabled={startMutation.isPending || nextMutation.isPending}>
              {(startMutation.isPending || nextMutation.isPending) && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              このセッションで始める
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === null) return "-";
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SpecRow({ label, value }: { label: string; value: unknown }) {
  const formatted = formatValue(value);
  if (formatted === "-" || formatted === "") return null;
  return (
    <div className="flex gap-2 text-sm">
      <div className="text-muted-foreground w-28 shrink-0">{label}</div>
      <div className="flex-1 break-words">{formatted}</div>
    </div>
  );
}

function SpecPreview({ spec }: { spec: CustomSessionSpec }) {
  return (
    <div className="bg-muted/40 space-y-1 rounded-md border p-3">
      <div className="text-muted-foreground mb-1 text-xs">
        パース結果 (読み取り専用)。MVP では concepts[0] / difficulty / thinkingStyles[0] のみ
        出題に反映。difficulty は beginner/junior/mid/senior のみサポート。
      </div>
      <SpecRow label="ドメイン" value={spec.domains} />
      <SpecRow label="サブドメイン" value={spec.subdomains} />
      <SpecRow label="concept" value={spec.concepts} />
      <SpecRow label="除外 concept" value={spec.excludeConcepts} />
      <SpecRow label="思考スタイル" value={spec.thinkingStyles} />
      <SpecRow label="問題形式" value={spec.questionTypes} />
      <SpecRow label="問題数" value={spec.questionCount} />
      <SpecRow label="難易度" value={spec.difficulty ? spec.difficulty.level : undefined} />
      {spec.constraints && (
        <>
          <SpecRow label="言語" value={spec.constraints.language} />
          <SpecRow label="コード言語" value={spec.constraints.codeLanguage} />
          <SpecRow label="時間制限 (秒)" value={spec.constraints.timeLimitSec} />
          <SpecRow label="必ず含めて" value={spec.constraints.mustInclude} />
          <SpecRow label="避けて" value={spec.constraints.avoid} />
        </>
      )}
      <SpecRow label="mastery 反映" value={spec.updateMastery} />
    </div>
  );
}
