import { create } from "zustand";

export type DrillQuestion = {
  id: string;
  prompt: string;
  /** サーバー側でシャッフル済み (answer + distractors が混在、正答位置は UI には渡さない) */
  options: string[];
  hint: string | null;
  tags: string[];
  /** copy-for-llm テンプレで使う concept / domain / 難易度 メタ (docs §7.13.4) */
  meta: {
    domain: string;
    subdomain: string;
    conceptId: string;
    conceptName: string;
    thinkingStyle: string | null;
    difficulty: string;
  } | null;
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
};

export type DrillSummary = {
  questionCount: number;
  correctCount: number;
  accuracy: number;
};

type Phase = "idle" | "asking" | "graded" | "finished";

export type DrillState = {
  phase: Phase;
  sessionId: string | null;
  question: DrillQuestion | null;
  selectedIndex: number | null;
  grading: DrillGrading | null;
  summary: DrillSummary | null;
};

type Actions = {
  reset: () => void;
  setSession: (sessionId: string) => void;
  setQuestion: (q: DrillQuestion | null) => void;
  setSelected: (idx: number) => void;
  setGrading: (g: DrillGrading) => void;
  updateGrading: (patch: Partial<DrillGrading>) => void;
  setSummary: (s: DrillSummary) => void;
};

export const useDrillStore = create<DrillState & Actions>((set) => ({
  phase: "idle",
  sessionId: null,
  question: null,
  selectedIndex: null,
  grading: null,
  summary: null,

  reset: () =>
    set({
      phase: "idle",
      sessionId: null,
      question: null,
      selectedIndex: null,
      grading: null,
      summary: null,
    }),

  setSession: (sessionId) => set({ sessionId, phase: "asking" }),

  setQuestion: (q) =>
    set(() => {
      if (!q) return { question: null, selectedIndex: null, phase: "asking" as const };
      return { question: q, selectedIndex: null, grading: null, phase: "asking" as const };
    }),

  setSelected: (idx) => set({ selectedIndex: idx }),

  setGrading: (g) => set({ grading: g, phase: "graded" }),

  updateGrading: (patch) => set((s) => (s.grading ? { grading: { ...s.grading, ...patch } } : {})),

  setSummary: (s) => set({ summary: s, phase: "finished" }),
}));
