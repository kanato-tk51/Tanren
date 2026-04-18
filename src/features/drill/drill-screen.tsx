"use client";

import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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

import { CopyForLlmButton } from "./copy-for-llm-button";
import { RebuttalForm } from "./rebuttal-form";
import { normalizeRubricChecks, useDrillStore } from "./drill-state";

type DrillScreenProps = {
  /** 完了後「ホームに戻る」を押したときの遷移ハンドラ (例: /custom に戻る)。
   *  未指定ならデフォルトの useDrillStore.reset() が走り、Daily Drill 開始カードに戻る。 */
  onReset?: () => void;
  /** idle で出るスタートカードの挙動を差し替える (例: /custom では使わない) */
  skipInitialStartCard?: boolean;
};

export function DrillScreen({ onReset, skipInitialStartCard }: DrillScreenProps = {}) {
  const { phase, sessionId, question, selectedIndex, grading, summary } = useDrillStore();
  const { reset, setSession, setQuestion, setSelected, setGrading, setSummary } = useDrillStore();
  const handleReset = onReset ?? reset;

  const startMutation = trpc.session.start.useMutation();
  const nextMutation = trpc.session.next.useMutation();
  const submitMutation = trpc.session.submit.useMutation();
  const finishMutation = trpc.session.finish.useMutation();

  const pending =
    startMutation.isPending ||
    nextMutation.isPending ||
    submitMutation.isPending ||
    finishMutation.isPending;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const options = question?.options ?? [];

  const toMessage = (e: unknown) => (e instanceof Error ? e.message : "通信エラー");

  const handleStart = useCallback(async () => {
    setErrorMessage(null);
    try {
      const { sessionId } = await startMutation.mutateAsync({ kind: "daily", targetCount: 5 });
      setSession(sessionId);
      const result = await nextMutation.mutateAsync({ sessionId });
      if (!result.done) setQuestion(result.question);
    } catch (e) {
      setErrorMessage(toMessage(e));
    }
  }, [startMutation, nextMutation, setSession, setQuestion]);

  const handleNext = useCallback(async () => {
    if (!sessionId) return;
    setErrorMessage(null);
    try {
      const result = await nextMutation.mutateAsync({ sessionId });
      if (result.done) {
        const s = await finishMutation.mutateAsync({ sessionId });
        setSummary({
          questionCount: s.questionCount,
          correctCount: s.correctCount,
          accuracy: s.accuracy,
        });
      } else {
        setQuestion(result.question);
      }
    } catch (e) {
      setErrorMessage(toMessage(e));
    }
  }, [sessionId, nextMutation, finishMutation, setQuestion, setSummary]);

  const handleSubmit = useCallback(async () => {
    if (!sessionId || !question || selectedIndex === null) return;
    const answer = question.options[selectedIndex];
    if (!answer) return;
    setErrorMessage(null);
    try {
      const result = await submitMutation.mutateAsync({
        sessionId,
        questionId: question.id,
        userAnswer: answer,
      });
      setGrading({
        attemptId: result.attemptId,
        correct: result.correct,
        score: result.score,
        feedback: result.feedback,
        correctIndex: result.correct ? selectedIndex : null,
        questionType: result.questionType ?? null,
        correctAnswer: result.correctAnswer ?? null,
        userAnswer: answer,
        rubricChecks: normalizeRubricChecks(result.rubricChecks),
      });
    } catch (e) {
      setErrorMessage(toMessage(e));
    }
  }, [sessionId, question, selectedIndex, submitMutation, setGrading]);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    if (phase === "idle") {
      void handleStart();
    } else if (phase === "asking" && !question) {
      void handleNext();
    } else if (phase === "asking" && question && selectedIndex !== null) {
      void handleSubmit();
    } else if (phase === "graded") {
      void handleNext();
    }
  }, [phase, question, selectedIndex, handleStart, handleNext, handleSubmit]);

  // セッション中の戻るジェスチャ / タブ閉じで意図せず終了しないよう警告
  // (issue #25 受け入れ基準: 戻るジェスチャで意図しない終了を防ぐ)。
  // - asking: 解答前
  // - graded: 解答済みで「次へ」未操作
  // finished / idle ではブロックしない (作業継続中ではないため)。
  useEffect(() => {
    if (!sessionId) return;
    if (phase !== "asking" && phase !== "graded") return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Chrome 互換のため returnValue を空文字でもセットする
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [sessionId, phase]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // キーリピート / 既に通信中の発火を全て無視 (submit/next の二重発火抑止)
      if (e.repeat || pending) return;
      if (phase === "asking" && question) {
        const n = Number.parseInt(e.key, 10);
        if (n >= 1 && n <= options.length) {
          setSelected(n - 1);
          e.preventDefault();
        } else if (e.key === "Enter" && selectedIndex !== null) {
          void handleSubmit();
          e.preventDefault();
        }
      } else if (phase === "graded" && e.key === "Enter") {
        void handleNext();
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    phase,
    question,
    options.length,
    selectedIndex,
    pending,
    handleSubmit,
    handleNext,
    setSelected,
  ]);

  if (phase === "idle") {
    if (skipInitialStartCard) {
      // 親 (/custom 等) が自前で session を用意する構成。何も出さない。
      return null;
    }
    return (
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Daily Drill</CardTitle>
          <CardDescription>5 問の mcq に解答します。</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={handleStart} disabled={pending} className="min-h-12 px-6">
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            スタート
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (phase === "finished" && summary) {
    return (
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>お疲れさまでした</CardTitle>
          <CardDescription>
            {summary.questionCount} 問中 {summary.correctCount} 問正解 (
            {Math.round(summary.accuracy * 100)}%)
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            onClick={() => {
              reset();
              handleReset();
            }}
            className="min-h-12 px-6"
          >
            ホームに戻る
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!question) {
    return (
      <Card className="w-full max-w-xl">
        <CardContent className="text-muted-foreground space-y-2 p-6 text-sm">
          {errorMessage ? (
            <div className="text-destructive flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <span className="break-all">{errorMessage}</span>
            </div>
          ) : (
            <div>
              <Loader2 className="inline h-4 w-4 animate-spin" /> 問題を読み込み中…
            </div>
          )}
        </CardContent>
        {errorMessage && (
          <CardFooter>
            <Button variant="outline" onClick={handleRetry}>
              再試行
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardDescription>{question.tags.join(" / ")}</CardDescription>
        <CardTitle className="text-base font-medium whitespace-pre-wrap">
          {question.prompt}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {options.map((opt, i) => {
          const isSelected = i === selectedIndex;
          const isGradedCorrect = phase === "graded" && grading?.correctIndex === i;
          const isWrongSelected = phase === "graded" && isSelected && grading?.correct === false;
          return (
            <button
              key={`${question.id}-${i}`}
              type="button"
              disabled={phase === "graded"}
              onClick={() => setSelected(i)}
              className={[
                "flex min-h-12 w-full items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors",
                isGradedCorrect
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                  : isWrongSelected
                    ? "border-destructive bg-red-50 dark:bg-red-950"
                    : isSelected
                      ? "border-primary"
                      : "border-border hover:border-muted-foreground",
              ].join(" ")}
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs">
                {i + 1}
              </span>
              <span className="flex-1 whitespace-pre-wrap">{opt}</span>
              {isGradedCorrect && <Check className="h-4 w-4 text-emerald-600" />}
              {isWrongSelected && <X className="text-destructive h-4 w-4" />}
            </button>
          );
        })}
        {phase === "graded" && grading && question && (
          <div className="space-y-2">
            <div className="bg-muted/50 rounded-md p-3 text-sm">{grading.feedback}</div>
            <div className="flex flex-wrap items-center gap-2">
              <CopyForLlmButton
                attemptId={grading.attemptId}
                question={{
                  prompt: question.prompt,
                  tags: question.tags,
                  hint: question.hint,
                  meta: question.meta,
                }}
                correctAnswer={grading.correctAnswer}
                userAnswer={grading.userAnswer}
                grading={{
                  correct: grading.correct,
                  score: grading.score,
                  feedback: grading.feedback,
                  rubricChecks: grading.rubricChecks,
                }}
              />
              {grading.questionType && grading.questionType !== "mcq" && (
                <RebuttalForm attemptId={grading.attemptId} />
              )}
            </div>
          </div>
        )}
        {errorMessage && (
          <div className="border-destructive/60 text-destructive flex items-start gap-2 rounded-md border bg-red-50 p-3 text-sm dark:bg-red-950">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div className="flex-1 break-all">{errorMessage}</div>
            <Button size="sm" variant="outline" onClick={handleRetry}>
              再試行
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        {phase === "asking" ? (
          <Button
            onClick={handleSubmit}
            disabled={selectedIndex === null || pending}
            className="min-h-12 px-6"
          >
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            回答する (Enter)
          </Button>
        ) : (
          <Button onClick={handleNext} disabled={pending} className="min-h-12 px-6">
            次へ (Enter)
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
