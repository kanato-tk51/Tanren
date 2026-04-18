"use client";

import { Clipboard, ClipboardCheck, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { buildCopyForLlm, type CopyForLlmInput } from "@/lib/share/copy-for-llm";
import { trpc } from "@/lib/trpc/react";

/**
 * 採点結果を LLM に貼り付け用に整形してコピーするボタン (issue #16)。
 * - デフォルトは clipboard.writeText、reject や未提供なら navigator.share にフォールバック
 * - 成功時はボタン下にトースト風の通知を表示 (docs/07 §7.13.3)
 * - 成功時に attempts.copiedForExternal +1
 */
export function CopyForLlmButton(props: {
  attemptId: string;
  /** 期待回答以外の question 情報 (prompt / tags / hint / meta) */
  question: Omit<CopyForLlmInput["question"], "answer">;
  /** 期待回答。取得失敗時は null でエラー表示 */
  correctAnswer: string | null;
  userAnswer: string | null;
  grading: CopyForLlmInput["grading"];
}) {
  const markMutation = trpc.attempts.markCopiedForExternal.useMutation();
  const [state, setState] = useState<"idle" | "copied" | "shared" | "error">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // トーストは 4 秒で自動で消す
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  async function tryCopyToClipboard(text: string): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  type ShareResult = "ok" | "cancelled" | "unavailable";
  async function tryShare(text: string): Promise<ShareResult> {
    if (typeof navigator === "undefined" || !navigator.share) return "unavailable";
    try {
      await navigator.share({ text });
      return "ok";
    } catch (e) {
      // ユーザーが Share Sheet をキャンセルした場合 DOMException(AbortError) が返る。
      // これはエラーではないのでサイレントに終了 (state はそのまま)
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      return "unavailable";
    }
  }

  const onClick = async () => {
    // 前回クリックの成功状態 / トーストが残らないよう、毎回冒頭でリセットする
    setErrorMessage(null);
    setState("idle");
    setToast(null);
    if (!props.correctAnswer) {
      setState("error");
      setErrorMessage("期待回答の取得に失敗しました。");
      return;
    }

    const text = buildCopyForLlm({
      question: { ...props.question, answer: props.correctAnswer },
      userAnswer: props.userAnswer ?? "",
      grading: props.grading,
    });

    // 1) clipboard.writeText を試す → 失敗したら 2) navigator.share で fallback
    if (await tryCopyToClipboard(text)) {
      setState("copied");
      setToast("コピーしました。ChatGPT / Claude に貼って深掘りしてください");
    } else {
      const shareResult = await tryShare(text);
      if (shareResult === "ok") {
        setState("shared");
        setToast("共有しました。ChatGPT / Claude に貼って深掘りしてください");
      } else if (shareResult === "cancelled") {
        // ユーザーキャンセルは無通知で完了 (カウンタも進めない)
        return;
      } else {
        setState("error");
        setErrorMessage("この環境では clipboard / share API が使えません");
        return;
      }
    }

    try {
      await markMutation.mutateAsync({ attemptId: props.attemptId });
    } catch {
      // カウンタ失敗は UX を止めない
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onClick} disabled={markMutation.isPending}>
          {state === "copied" ? (
            <ClipboardCheck className="mr-1 h-3.5 w-3.5 text-emerald-600" />
          ) : state === "shared" ? (
            <Share2 className="mr-1 h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Clipboard className="mr-1 h-3.5 w-3.5" />
          )}
          📋 詳しく聞く用にコピー
        </Button>
        {state === "error" && errorMessage && (
          <span className="text-destructive text-xs">{errorMessage}</span>
        )}
      </div>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="border-border bg-muted/50 text-muted-foreground rounded-md border px-2 py-1 text-xs"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
