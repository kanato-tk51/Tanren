"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Loader2,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
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
 *
 * Insights Dashboard 等から ?conceptId=... で来た場合は、LLM parse を迂回して
 * initialSpec (concepts=[conceptId], questionCount=5) を decoding で組み立て、
 * そのまま previewing 状態に遷移する (Round 3 指摘 #1 対応)。
 */
export function CustomScreen({
  initialRaw,
  initialConceptId,
}: { initialRaw?: string; initialConceptId?: string } = {}) {
  // initialConceptId があれば LLM を通さず previewing に直行する。
  const initialSpec: CustomSessionSpec | null = initialConceptId
    ? { concepts: [initialConceptId], questionCount: 5 }
    : null;
  const initialRawForPreview = initialSpec
    ? (initialRaw ?? `concept ${initialConceptId} を 5 問`)
    : "";
  const [phase, setPhase] = useState<Phase>(
    initialSpec
      ? { kind: "previewing", raw: initialRawForPreview, spec: initialSpec }
      : { kind: "input" },
  );
  const [raw, setRaw] = useState(initialRaw ?? initialRawForPreview);
  const [error, setError] = useState<string | null>(null);

  const parseMutation = trpc.custom.parse.useMutation();
  const startMutation = trpc.session.start.useMutation();
  const nextMutation = trpc.session.next.useMutation();
  const templatesQuery = trpc.custom.listTemplates.useQuery();
  const saveTemplate = trpc.custom.saveTemplate.useMutation();
  const useTemplateMut = trpc.custom.useTemplate.useMutation();
  const deleteTemplateMut = trpc.custom.deleteTemplate.useMutation();
  const utils = trpc.useUtils();
  const { reset, setSession, setQuestion } = useDrillStore();
  const [savingName, setSavingName] = useState("");

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
    const snapshot = phase;
    setError(null);
    try {
      reset();
      const { sessionId } = await startMutation.mutateAsync({
        kind: "custom",
        customSpec: snapshot.spec,
      });
      // setSession は next 成功後に実行 (store を先に埋めて DrillScreen が半端な
      // ローディング状態に入るのを防ぐ)。next 失敗時は session row が DB に残るが
      // 孤立せず、ユーザーが Raw を直して再度「このセッションで始める」を押すと
      // 新しい session が作られる (MVP はこれで許容、誤 session は UI からは
      // 到達不能なためコスト上の害は小)。
      try {
        const next = await nextMutation.mutateAsync({ sessionId });
        setSession(sessionId);
        setPhase({ kind: "running", sessionId });
        if (!next.done) setQuestion(next.question);
      } catch (e) {
        // 問題生成失敗時は previewing に戻してエラー表示。
        setPhase(snapshot);
        setError(e instanceof Error ? e.message : "問題の生成に失敗しました");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "セッション開始に失敗しました");
    }
  }, [phase, startMutation, nextMutation, setSession, setQuestion, reset]);

  const backToInput = useCallback(() => {
    reset();
    setError(null);
    setPhase({ kind: "input" });
  }, [reset]);

  const onSaveTemplate = useCallback(async () => {
    if (phase.kind !== "previewing") return;
    const name = savingName.trim();
    if (name.length === 0) {
      setError("テンプレ名を入力してください");
      return;
    }
    try {
      await saveTemplate.mutateAsync({ name, rawRequest: phase.raw, spec: phase.spec });
      setSavingName("");
      await utils.custom.listTemplates.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "テンプレ保存に失敗しました");
    }
  }, [phase, savingName, saveTemplate, utils]);

  const onUseTemplate = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const t = await useTemplateMut.mutateAsync({ id });
        setRaw(t.rawRequest ?? "");
        setPhase({ kind: "previewing", raw: t.rawRequest ?? "", spec: t.spec });
        await utils.custom.listTemplates.invalidate();
      } catch (e) {
        setError(e instanceof Error ? e.message : "テンプレの読み込みに失敗しました");
      }
    },
    [useTemplateMut, utils],
  );

  const onDeleteTemplate = useCallback(
    async (id: string) => {
      try {
        await deleteTemplateMut.mutateAsync({ id });
        await utils.custom.listTemplates.invalidate();
      } catch (e) {
        setError(e instanceof Error ? e.message : "テンプレの削除に失敗しました");
      }
    },
    [deleteTemplateMut, utils],
  );

  if (phase.kind === "running") {
    // pending-offline は未完了離脱扱い、backToInput で入力画面に戻す (完了時と同じ挙動
    // でよい: custom は完了しても結果カードを持たず backToInput に戻るため)。
    return (
      <DrillScreen onReset={backToInput} onOfflinePendingLeave={backToInput} skipInitialStartCard />
    );
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
        {phase.kind === "previewing" && (
          <div className="bg-muted/20 space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-xs font-medium">
              <Bookmark className="h-3 w-3" />
              このセッションをテンプレに保存
            </label>
            <div className="flex gap-2">
              <input
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                maxLength={80}
                placeholder="例: TLS 深掘り"
                className="border-input bg-background min-h-10 flex-1 rounded-md border px-2 text-sm"
                aria-label="テンプレ名"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={onSaveTemplate}
                disabled={saveTemplate.isPending || savingName.trim().length === 0}
              >
                {saveTemplate.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <BookmarkCheck className="mr-1 h-3 w-3" />
                )}
                保存
              </Button>
            </div>
          </div>
        )}
        {phase.kind === "input" && (templatesQuery.data?.items.length ?? 0) > 0 && (
          <div className="bg-muted/20 space-y-2 rounded-md border p-3">
            <div className="text-xs font-medium">💾 保存済みテンプレート</div>
            <ul className="space-y-1">
              {(templatesQuery.data?.items ?? []).map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => onUseTemplate(t.id)}
                    disabled={useTemplateMut.isPending}
                    className="hover:bg-accent flex-1 rounded-md border px-2 py-1 text-left disabled:opacity-50"
                  >
                    <div className="font-medium">{t.name}</div>
                    {t.rawRequest && (
                      <div className="text-muted-foreground truncate text-xs">{t.rawRequest}</div>
                    )}
                    <div className="text-muted-foreground text-xs">
                      {t.useCount} 回使用
                      {t.lastUsedAt
                        ? ` ・ 最終: ${new Date(t.lastUsedAt).toLocaleDateString("ja-JP")}`
                        : null}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteTemplate(t.id)}
                    disabled={deleteTemplateMut.isPending}
                    aria-label={`${t.name} を削除`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
        パース結果 (読み取り専用)。MVP で反映されるのは concepts (0-1件) / difficulty /
        thinkingStyles (0-1件) / questionCount / updateMastery のみ。 difficulty は 6 段階全て
        (beginner/junior/mid/senior/staff/principal) 受け入れ、 questionTypes は [&quot;mcq&quot;]
        単一要素のみ、それ以外のフィールド (domains / subdomains / excludeConcepts / constraints /
        複数 concepts / 複数 thinkingStyles / mcq 以外 questionTypes) は開始時に reject されます。
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
