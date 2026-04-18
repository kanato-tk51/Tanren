"use client";

import { AlertTriangle, Flag, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/react";

import { useDrillStore } from "./drill-state";

/**
 * 採点結果への反論フォーム (issue #15, R1 対策)。
 * 短答・記述 (short / written) でのみ有効。mcq には表示しない。
 */
export function RebuttalForm({
  attemptId,
  onResolved,
}: {
  attemptId: string;
  onResolved?: (result: { overturned: boolean }) => void;
}) {
  const { updateGrading, grading } = useDrillStore();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rebutMutation = trpc.attempts.rebut.useMutation();

  if (grading?.rebutted) {
    return (
      <div className="text-muted-foreground text-xs">
        この回答は反論済みです (1 attempt につき 1 回)。
      </div>
    );
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-destructive border-destructive/40 hover:bg-destructive/10"
      >
        <Flag className="mr-1 h-3.5 w-3.5" />
        採点に反論
      </Button>
    );
  }

  const onSubmit = async () => {
    setError(null);
    setNotice(null);
    const trimmed = message.trim();
    if (!trimmed) {
      setError("反論の根拠を入力してください");
      return;
    }
    try {
      const res = await rebutMutation.mutateAsync({ attemptId, message: trimmed });
      updateGrading({
        correct: res.correct,
        score: res.score,
        feedback: res.feedback,
        rebutted: true,
      });
      setNotice(
        res.overturned
          ? "反論を受け入れ、採点を修正しました。"
          : "反論を検討しましたが判定は変わりませんでした。",
      );
      setOpen(false);
      setMessage("");
      onResolved?.({ overturned: res.overturned });
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    }
  };

  return (
    <div className="border-destructive/40 space-y-2 rounded-md border p-3">
      <div className="text-muted-foreground text-xs">なぜ正解だと考えるか、1-2 文で。</div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={2000}
        className="border-input bg-background w-full rounded-md border p-2 text-sm"
        placeholder="例: 「状態が変わらない」は冪等性の言い換えです。"
      />
      {error && (
        <div className="text-destructive flex items-start gap-1 text-xs">
          <AlertTriangle className="mt-0.5 h-3 w-3" />
          <span>{error}</span>
        </div>
      )}
      {notice && <div className="text-muted-foreground text-xs">{notice}</div>}
      <div className="flex gap-2">
        <Button size="sm" onClick={onSubmit} disabled={rebutMutation.isPending}>
          {rebutMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          送信
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={rebutMutation.isPending}
        >
          キャンセル
        </Button>
      </div>
    </div>
  );
}
