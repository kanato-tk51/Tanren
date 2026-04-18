"use client";

import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
   *  未指定ならデフォルトの useDrillStore.reset() が走り、Daily Drill 開始カードに戻る。
   *  最終 summary を引数で渡す: 親側は reset() で store がクリアされる前にスナップショット
   *  できる (issue #26 onboarding 結果カード用、Codex Round 1 指摘 #1)。 */
  onReset?: (finalSummary: import("./drill-state").DrillSummary | null) => void;
  /** idle で出るスタートカードの挙動を差し替える (例: /custom では使わない) */
  skipInitialStartCard?: boolean;
};

export function DrillScreen({ onReset, skipInitialStartCard }: DrillScreenProps = {}) {
  const { phase, sessionId, question, selectedIndex, textAnswer, grading, summary } =
    useDrillStore();
  const { reset, setSession, setQuestion, setSelected, setTextAnswer, setGrading, setSummary } =
    useDrillStore();

  // mcq 以外 (cloze / code_read / short / written) は textarea で自由入力
  const isTextInput = question?.type !== "mcq";
  // 既定 (onReset 未指定) は zustand reset。引数 finalSummary は無視されるが
  // 関数シグネチャは optional 引数で互換 (custom / review もそのまま動く)。
  const handleReset = onReset ?? (() => reset());

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
    if (!sessionId || !question) return;
    // mcq は selectedIndex から option を取り出す、それ以外は textAnswer を使う (issue #31)
    const answer = isTextInput ? textAnswer.trim() : question.options[selectedIndex ?? -1];
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
        // correctIndex は mcq でユーザーが選んだインデックスが正解だったか UI ハイライトに使う
        correctIndex: !isTextInput && result.correct ? selectedIndex : null,
        questionType: result.questionType ?? null,
        correctAnswer: result.correctAnswer ?? null,
        userAnswer: answer,
        rubricChecks: normalizeRubricChecks(result.rubricChecks),
      });
    } catch (e) {
      setErrorMessage(toMessage(e));
    }
  }, [sessionId, question, selectedIndex, textAnswer, isTextInput, submitMutation, setGrading]);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    if (phase === "idle") {
      void handleStart();
    } else if (phase === "asking" && !question) {
      void handleNext();
    } else if (
      phase === "asking" &&
      question &&
      (selectedIndex !== null || textAnswer.trim().length > 0)
    ) {
      void handleSubmit();
    } else if (phase === "graded") {
      void handleNext();
    }
  }, [phase, question, selectedIndex, textAnswer, handleStart, handleNext, handleSubmit]);

  // セッション中の戻るジェスチャ / タブ閉じで意図せず終了しないよう警告
  // (issue #25 受け入れ基準: 戻るジェスチャで意図しない終了を防ぐ)。
  //
  // - beforeunload: タブ閉じ / リロード / 外部ドメイン遷移 (browser ネイティブの確認)
  // - popstate + sentinel pushState: SPA 内の戻る (iOS edge swipe / Android back / browser back)。
  //   beforeunload は SPA の popstate では発火しないため、別経路で intercept する必要がある。
  //
  // phase が asking | graded のときのみ guard を有効化。最新 phase は ref 経由で参照し、
  // listener を毎回 re-bind しない (sentinel が phase 切替で重複 push されないように)。
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!sessionId) return;

    let trapPushed = false;

    function pushTrap() {
      if (trapPushed) return;
      window.history.pushState({ tanren: "drill-guard" }, "");
      trapPushed = true;
    }

    function onBeforeUnload(e: BeforeUnloadEvent) {
      const p = phaseRef.current;
      if (p !== "asking" && p !== "graded") return;
      e.preventDefault();
      e.returnValue = "";
    }

    function onPopState() {
      // popstate 発火 = trap entry が consume された
      trapPushed = false;
      const p = phaseRef.current;
      if (p !== "asking" && p !== "graded") return;
      const leave = window.confirm("セッションを離れますか? 回答中の進捗は失われます。");
      if (leave) {
        // 自分自身を外してから history.back() を呼ぶ。続けて発火する popstate は
        // listener なしで silent に処理され、confirm の再入や多重 back を起こさない
        // (Codex Round 2 指摘 #1)。
        window.removeEventListener("popstate", onPopState);
        window.removeEventListener("beforeunload", onBeforeUnload);
        window.history.back();
      } else {
        // キャンセル: trap を再度積んで /drill に留まる
        pushTrap();
      }
    }

    pushTrap();
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // session が終了したら sentinel を回収して、次の戻る操作が「無音の back」に
      // ならないようにする (Codex Round 2 指摘 #2)。
      // listener は既に外しているので history.back() の popstate は silent に処理される。
      if (trapPushed) {
        trapPushed = false;
        window.history.back();
      }
    };
  }, [sessionId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // キーリピート / 既に通信中の発火を全て無視 (submit/next の二重発火抑止)
      if (e.repeat || pending) return;
      if (phase === "asking" && question) {
        // mcq: 数字キー 1-N で選択肢、Enter で送信。textarea の中での数字キーやスペースは
        // document レベルで拾わないため、isTextInput のときは textarea に任せる。
        if (!isTextInput) {
          const n = Number.parseInt(e.key, 10);
          if (n >= 1 && n <= options.length) {
            setSelected(n - 1);
            e.preventDefault();
            return;
          }
        }
        // Cmd/Ctrl+Enter で送信 (textarea 内では naked Enter は改行)
        const submitKey = isTextInput
          ? e.key === "Enter" && (e.metaKey || e.ctrlKey)
          : e.key === "Enter";
        if (submitKey) {
          const canSubmit =
            (!isTextInput && selectedIndex !== null) ||
            (isTextInput && textAnswer.trim().length > 0);
          if (canSubmit) {
            void handleSubmit();
            e.preventDefault();
          }
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
    textAnswer,
    isTextInput,
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
              // reset() より先に summary をローカル変数に取り出し、handleReset に渡す。
              // store を先にクリアすると親側 (onboarding 等) で summary を読み損ねるため。
              const finalSummary = summary;
              reset();
              handleReset(finalSummary);
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

  const isCodeRead = question.type === "code_read";
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardDescription>
          {question.tags.join(" / ")}
          {question.type !== "mcq" ? ` ・ ${question.type}` : null}
        </CardDescription>
        {isCodeRead ? (
          // code_read: prompt は「次のコードの出力を答えよ」+ コード。
          // コード部分を <pre> でモノスペース表示 (CodeMirror は重い+display-only なので MVP では不要)。
          <CardTitle className="text-base font-medium">
            <pre className="bg-muted/50 overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre">
              {question.prompt}
            </pre>
            <p className="mt-2 text-sm font-normal">このコードの出力を予測して入力してください。</p>
          </CardTitle>
        ) : (
          <CardTitle className="text-base font-medium whitespace-pre-wrap">
            {question.prompt}
          </CardTitle>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isTextInput && (
          <textarea
            value={textAnswer}
            onChange={(e) => setTextAnswer(e.target.value)}
            disabled={phase === "graded"}
            rows={isCodeRead ? 6 : 3}
            placeholder={
              question.type === "cloze"
                ? "穴埋めする内容を入力"
                : isCodeRead
                  ? "期待される出力"
                  : "回答を入力"
            }
            className="border-input bg-background min-h-20 w-full rounded-md border p-2 font-mono text-sm"
            aria-label="回答入力"
          />
        )}
        {!isTextInput &&
          options.map((opt, i) => {
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
            disabled={
              pending || (isTextInput ? textAnswer.trim().length === 0 : selectedIndex === null)
            }
            className="min-h-12 px-6"
          >
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {isTextInput ? "回答する (Cmd+Enter)" : "回答する (Enter)"}
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
