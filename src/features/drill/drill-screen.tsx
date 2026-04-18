"use client";

import { Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect } from "react";

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

import { useDrillStore } from "./drill-state";

export function DrillScreen() {
  const { phase, sessionId, question, selectedIndex, grading, summary } = useDrillStore();
  const { reset, setSession, setQuestion, setSelected, setGrading, setSummary } = useDrillStore();

  const startMutation = trpc.session.start.useMutation();
  const nextMutation = trpc.session.next.useMutation();
  const submitMutation = trpc.session.submit.useMutation();
  const finishMutation = trpc.session.finish.useMutation();

  const pending =
    startMutation.isPending ||
    nextMutation.isPending ||
    submitMutation.isPending ||
    finishMutation.isPending;

  const options = question?.options ?? [];

  const handleStart = useCallback(async () => {
    const { sessionId } = await startMutation.mutateAsync({ kind: "daily", targetCount: 5 });
    setSession(sessionId);
    const result = await nextMutation.mutateAsync({ sessionId });
    if (!result.done) setQuestion(result.question);
  }, [startMutation, nextMutation, setSession, setQuestion]);

  const handleNext = useCallback(async () => {
    if (!sessionId) return;
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
  }, [sessionId, nextMutation, finishMutation, setQuestion, setSummary]);

  const handleSubmit = useCallback(async () => {
    if (!sessionId || !question || selectedIndex === null) return;
    const answer = question.options[selectedIndex];
    if (!answer) return;
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
      // 正答インデックスは採点結果から UI 側で復元する (サーバーは answer を返さない)
      correctIndex: result.correct ? selectedIndex : null,
    });
  }, [sessionId, question, selectedIndex, submitMutation, setGrading]);

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
    return (
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Daily Drill</CardTitle>
          <CardDescription>5 問の mcq に解答します。</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={handleStart} disabled={pending}>
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
          <Button onClick={reset}>ホームに戻る</Button>
        </CardFooter>
      </Card>
    );
  }

  if (!question) {
    return (
      <Card className="w-full max-w-xl">
        <CardContent className="text-muted-foreground p-6 text-sm">
          <Loader2 className="inline h-4 w-4 animate-spin" /> 問題を読み込み中…
        </CardContent>
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
                "flex w-full items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors",
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
        {phase === "graded" && grading && (
          <div className="bg-muted/50 rounded-md p-3 text-sm">{grading.feedback}</div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        {phase === "asking" ? (
          <Button onClick={handleSubmit} disabled={selectedIndex === null || pending}>
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            回答する (Enter)
          </Button>
        ) : (
          <Button onClick={handleNext} disabled={pending}>
            次へ (Enter)
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
