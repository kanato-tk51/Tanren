import { create } from "zustand";

export type DrillQuestion = {
  id: string;
  prompt: string;
  /** サーバー側でシャッフル済み (answer + distractors が混在、正答位置は UI には渡さない) */
  options: string[];
  hint: string | null;
  tags: string[];
};

export type DrillGrading = {
  attemptId: string;
  correct: boolean;
  score: number | null;
  feedback: string;
  /** 選択したインデックスが正解だったかを UI ハイライトに使う */
  correctIndex: number | null;
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

  setSummary: (s) => set({ summary: s, phase: "finished" }),
}));
