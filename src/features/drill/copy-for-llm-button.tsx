"use client";

import { Clipboard, ClipboardCheck, Share2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { buildCopyForLlm } from "@/lib/share/copy-for-llm";
import { trpc } from "@/lib/trpc/react";

/**
 * 採点結果を LLM に貼り付け用に整形してコピーするボタン (issue #16)。
 * - PC: クリップボードへコピー (`navigator.clipboard.writeText`)
 * - モバイルで share API が使える場合はそちらにフォールバック
 * - 成功時は `attempts.copiedForExternal` を +1 してカウンタを進める
 */
export function CopyForLlmButton(props: {
  attemptId: string;
  question: {
    prompt: string;
    tags: string[];
    hint: string | null;
  };
  correctAnswer: string | null;
  userAnswer: string | null;
  grading: {
    correct: boolean;
    score: number | null;
    feedback: string;
  };
}) {
  const markMutation = trpc.attempts.markCopiedForExternal.useMutation();
  const [state, setState] = useState<"idle" | "copied" | "shared" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onClick = async () => {
    setErrorMessage(null);
    if (!props.correctAnswer) {
      setState("error");
      setErrorMessage("期待回答の取得に失敗しました。");
      return;
    }

    const text = buildCopyForLlm({
      question: {
        prompt: props.question.prompt,
        answer: props.correctAnswer,
        tags: props.question.tags,
        hint: props.question.hint,
      },
      userAnswer: props.userAnswer ?? "",
      grading: props.grading,
    });

    let finalState: "copied" | "shared" = "copied";
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text });
        finalState = "shared";
      } else {
        throw new Error("clipboard / share API が利用できません");
      }
    } catch (e) {
      setState("error");
      setErrorMessage(e instanceof Error ? e.message : "コピーに失敗しました");
      return;
    }

    setState(finalState);
    try {
      await markMutation.mutateAsync({ attemptId: props.attemptId });
    } catch {
      // 計測カウンタの失敗は UX を止めない (トースト表示も不要)
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onClick} disabled={markMutation.isPending}>
        {state === "copied" ? (
          <ClipboardCheck className="mr-1 h-3.5 w-3.5 text-emerald-600" />
        ) : state === "shared" ? (
          <Share2 className="mr-1 h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Clipboard className="mr-1 h-3.5 w-3.5" />
        )}
        {state === "copied"
          ? "コピーしました"
          : state === "shared"
            ? "共有しました"
            : "📋 詳しく聞く用にコピー"}
      </Button>
      {state === "error" && errorMessage && (
        <span className="text-destructive text-xs">{errorMessage}</span>
      )}
    </div>
  );
}
