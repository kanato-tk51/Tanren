import { create } from "zustand";

import type { CopyForLlmQuestionMeta } from "@/lib/share/copy-for-llm";

/** submit / rebut 経路の API レスポンスから drill store 用の rubricChecks を正規化する */
export function normalizeRubricChecks(
  raw: Array<{ id: string; passed: boolean; comment?: string | null }> | null | undefined,
): Array<{ id: string; passed: boolean; comment: string }> {
  return (raw ?? []).map((r) => ({
    id: r.id,
    passed: r.passed,
    comment: r.comment ?? "",
  }));
}

export type DrillQuestion = {
  id: string;
  prompt: string;
  /** UI ディスパッチ用。mcq は option ボタン、cloze/code_read/short/written は textarea 入力 (issue #31) */
  type: string;
  /** サーバー側でシャッフル済み (answer + distractors が混在、正答位置は UI には渡さない)。
   *  cloze / code_read 等 mcq 以外では空配列 */
  options: string[];
  hint: string | null;
  tags: string[];
  /** copy-for-llm テンプレで使う concept / domain / 難易度 メタ (docs §7.13.4) */
  meta: CopyForLlmQuestionMeta | null;
};

export type DrillGrading = {
  attemptId: string;
  correct: boolean;
  score: number | null;
  feedback: string;
  /** 選択したインデックスが正解だったかを UI ハイライトに使う */
  correctIndex: number | null;
  /** 反論ボタン出し分け用 (mcq は反論不可) */
  questionType: string | null;
  /** 反論済みフラグ (1 attempt につき 1 回) */
  rebutted?: boolean;
  /** 正解のテキスト (copy-for-llm / 採点後の表示に使う) */
  correctAnswer: string | null;
  /** ユーザーが実際に回答した文字列 (mcq は選択した選択肢の文言) */
  userAnswer: string | null;
  /** copy-for-llm テンプレで使う採点ルーブリック結果 (短答・記述のみ埋まる) */
  rubricChecks: Array<{ id: string; passed: boolean; comment: string }>;
};

export type DrillSummary = {
  questionCount: number;
  correctCount: number;
  accuracy: number;
};

/** `pending-offline` はオフラインで enqueueSubmit 済みかつ次 drain 待ちの状態 (issue #40)。
 *  submit / 再試行は無効化、画面は「接続復帰後に採点されます」メッセージを出す。
 *  online 復帰後に OfflineDrainer が drain すると pendingQuestionId がサーバー側で
 *  進むため、同じ UI から再 submit するとミスマッチで BAD_REQUEST になる。そのため
 *  このフェーズは「ホームに戻る」以外の次遷移を持たない閉じた状態として扱う
 *  (Codex PR#87 Round 3 指摘)。 */
type Phase = "idle" | "asking" | "graded" | "pending-offline" | "finished";

export type DrillState = {
  phase: Phase;
  sessionId: string | null;
  question: DrillQuestion | null;
  /** mcq での選択肢インデックス (cloze/code_read 等では使用しない) */
  selectedIndex: number | null;
  /** cloze / code_read / short / written での自由入力テキスト (issue #31) */
  textAnswer: string;
  grading: DrillGrading | null;
  summary: DrillSummary | null;
};

type Actions = {
  reset: () => void;
  setSession: (sessionId: string) => void;
  setQuestion: (q: DrillQuestion | null) => void;
  setSelected: (idx: number) => void;
  setTextAnswer: (text: string) => void;
  setGrading: (g: DrillGrading) => void;
  updateGrading: (patch: Partial<DrillGrading>) => void;
  setSummary: (s: DrillSummary) => void;
  /** オフラインで enqueue 済み状態に遷移。submit / 再試行を抑止する */
  setPendingOffline: () => void;
};

export const useDrillStore = create<DrillState & Actions>((set) => ({
  phase: "idle",
  sessionId: null,
  question: null,
  selectedIndex: null,
  textAnswer: "",
  grading: null,
  summary: null,

  reset: () =>
    set({
      phase: "idle",
      sessionId: null,
      question: null,
      selectedIndex: null,
      textAnswer: "",
      grading: null,
      summary: null,
    }),

  setSession: (sessionId) => set({ sessionId, phase: "asking" }),

  setQuestion: (q) =>
    set(() => {
      if (!q)
        return {
          question: null,
          selectedIndex: null,
          textAnswer: "",
          phase: "asking" as const,
        };
      return {
        question: q,
        selectedIndex: null,
        textAnswer: "",
        grading: null,
        phase: "asking" as const,
      };
    }),

  setSelected: (idx) => set({ selectedIndex: idx }),

  setTextAnswer: (text) => set({ textAnswer: text }),

  setGrading: (g) => set({ grading: g, phase: "graded" }),

  updateGrading: (patch) => set((s) => (s.grading ? { grading: { ...s.grading, ...patch } } : {})),

  setSummary: (s) => set({ summary: s, phase: "finished" }),

  setPendingOffline: () => set({ phase: "pending-offline" }),
}));
