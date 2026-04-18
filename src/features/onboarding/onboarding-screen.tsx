"use client";

import { ArrowRight, BookOpen, Brain, ListChecks, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/cn";
import { TIER_1_DOMAIN_IDS, type DomainId, type Tier1DomainId } from "@/db/schema";
import { DrillScreen } from "@/features/drill/drill-screen";
import { useDrillStore } from "@/features/drill/drill-state";
import { trpc } from "@/lib/trpc/react";

type Step =
  | { kind: "welcome"; index: 0 | 1 | 2 }
  | { kind: "preferences" }
  | { kind: "running" }
  | { kind: "result" };

const WELCOME_SLIDES: Array<{ icon: typeof Brain; title: string; body: string }> = [
  {
    icon: Brain,
    title: "AI がエンジニアのための問題を出します",
    body: "domain × thinking style に沿って、あなたに合わせた MCQ を生成します。",
  },
  {
    icon: BookOpen,
    title: "忘れる前に再出題する科学的な仕組み",
    body: "FSRS (Spaced Repetition) で「忘れそうなタイミング」を狙って復習します。",
  },
  {
    icon: ListChecks,
    title: "あなたの学習状態を診断します",
    body: "次の数問で出発点を測ります。3〜5 分で終わります。",
  },
];

const TIER_1_LABELS: Record<DomainId, string> = {
  programming: "Programming",
  dsa: "DSA",
  os: "OS",
  network: "Network",
  db: "Database",
  security: "Security",
  distributed: "Distributed",
  design: "Design",
  devops: "DevOps",
  tools: "Tools",
  low_level: "Low-level",
  ai_ml: "AI / ML",
  frontend: "Frontend",
};

type SelfLevel = "beginner" | "junior" | "mid" | "senior";

const SELF_LEVELS: Array<{ id: SelfLevel; label: string; hint: string }> = [
  { id: "beginner", label: "Beginner", hint: "学習を始めたばかり" },
  { id: "junior", label: "Junior", hint: "業務 1〜2 年" },
  { id: "mid", label: "Mid", hint: "業務 3〜5 年" },
  { id: "senior", label: "Senior", hint: "業務 5 年以上" },
];

export function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "welcome", index: 0 });
  const [interestDomains, setInterestDomains] = useState<Tier1DomainId[]>([]);
  const [selfLevel, setSelfLevel] = useState<SelfLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  // result カードに表示する診断結果のスナップショット。
  // DrillScreen が onReset 経由で finalSummary を渡してくれるので、
  // event handler 内で setState するだけで済む (Codex Round 1 指摘 #1)。
  const [resultSnapshot, setResultSnapshot] = useState<{
    questionCount: number;
    correctCount: number;
    accuracy: number;
  } | null>(null);

  const savePrefs = trpc.onboarding.savePreferences.useMutation();
  const completeOnboarding = trpc.onboarding.complete.useMutation();
  const startSession = trpc.session.start.useMutation();
  const nextQuestion = trpc.session.next.useMutation();
  const { reset, setSession, setQuestion } = useDrillStore();

  const toggleDomain = useCallback((d: Tier1DomainId) => {
    setInterestDomains((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }, []);

  const onStartDiagnostic = useCallback(async () => {
    if (interestDomains.length === 0 || !selfLevel) return;
    setError(null);
    try {
      await savePrefs.mutateAsync({ interestDomains, selfLevel });
      reset();
      const { sessionId } = await startSession.mutateAsync({ kind: "diagnostic" });
      const next = await nextQuestion.mutateAsync({ sessionId });
      setSession(sessionId);
      setStep({ kind: "running" });
      if (!next.done) setQuestion(next.question);
    } catch (e) {
      setError(e instanceof Error ? e.message : "診断テストの開始に失敗しました");
    }
  }, [
    interestDomains,
    selfLevel,
    savePrefs,
    startSession,
    nextQuestion,
    reset,
    setSession,
    setQuestion,
  ]);

  const onComplete = useCallback(async () => {
    setError(null);
    try {
      await completeOnboarding.mutateAsync();
      reset();
      router.replace("/");
      router.refresh(); // Server Component の getCurrentUser を再評価
    } catch (e) {
      setError(e instanceof Error ? e.message : "オンボーディング完了の保存に失敗しました");
    }
  }, [completeOnboarding, reset, router]);

  // === running: DrillScreen を埋め込み、終了時 (summary が埋まったら) result に遷移 ===
  if (step.kind === "running") {
    return (
      <DrillScreen
        onReset={(finalSummary) => {
          setResultSnapshot(finalSummary);
          setStep({ kind: "result" });
        }}
        skipInitialStartCard
      />
    );
  }

  // === result: 簡易サマリ + 「最初の Daily Drill へ」 ===
  if (step.kind === "result") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>診断テスト完了</CardTitle>
          <CardDescription>
            {resultSnapshot
              ? `${resultSnapshot.questionCount} 問中 ${resultSnapshot.correctCount} 問正解 (${Math.round(resultSnapshot.accuracy * 100)}%)`
              : "結果を保存しました"}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>各 concept の初期 mastery を更新しました。</p>
          <p>次は今日の Daily Drill から始めましょう。</p>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          {error && <p className="text-destructive text-xs">{error}</p>}
          <Button
            onClick={onComplete}
            disabled={completeOnboarding.isPending}
            className="min-h-12 w-full px-6"
          >
            {completeOnboarding.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            ホームへ
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // === preferences: 興味分野 + 自己申告レベル ===
  if (step.kind === "preferences") {
    const startDisabled =
      interestDomains.length === 0 ||
      !selfLevel ||
      savePrefs.isPending ||
      startSession.isPending ||
      nextQuestion.isPending;
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>あなたについて</CardTitle>
          <CardDescription>分野とレベルを教えてください (後から変更可能)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">興味のある分野 (複数可)</p>
            <div className="grid grid-cols-2 gap-2">
              {TIER_1_DOMAIN_IDS.map((d) => {
                const active = interestDomains.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDomain(d)}
                    aria-pressed={active}
                    className={cn(
                      "min-h-12 rounded-md border px-3 py-2 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-muted-foreground",
                    )}
                  >
                    {TIER_1_LABELS[d]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">自己申告レベル</p>
            <div className="grid grid-cols-2 gap-2">
              {SELF_LEVELS.map(({ id, label, hint }) => {
                const active = selfLevel === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelfLevel(id)}
                    aria-pressed={active}
                    className={cn(
                      "min-h-12 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-muted-foreground",
                    )}
                  >
                    <div className="font-medium">{label}</div>
                    <div className="text-muted-foreground text-xs">{hint}</div>
                  </button>
                );
              })}
            </div>
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
        </CardContent>
        <CardFooter>
          <Button
            onClick={onStartDiagnostic}
            disabled={startDisabled}
            className="min-h-12 w-full px-6"
          >
            {(savePrefs.isPending || startSession.isPending || nextQuestion.isPending) && (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            )}
            診断テストを始める
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // === welcome: 3 枚のカードをページネーション ===
  const slide = WELCOME_SLIDES[step.index]!;
  const Icon = slide.icon;
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Icon className="text-primary h-8 w-8" aria-hidden="true" />
        <CardTitle>{slide.title}</CardTitle>
        <CardDescription>{slide.body}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex justify-center gap-1.5" aria-label={`スライド ${step.index + 1} / 3`}>
          {WELCOME_SLIDES.map((_, i) => (
            <span
              key={i}
              className={cn("h-1.5 w-6 rounded-full", i === step.index ? "bg-primary" : "bg-muted")}
              aria-hidden="true"
            />
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button
          onClick={() => {
            if (step.index < 2) {
              setStep({ kind: "welcome", index: (step.index + 1) as 1 | 2 });
            } else {
              setStep({ kind: "preferences" });
            }
          }}
          className="min-h-12 w-full px-6"
        >
          次へ
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
