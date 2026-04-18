import { create } from "zustand";

export type DrillQuestion = {
  id: string;
  prompt: string;
  answer: string;
  distractors: string[];
  hint: string | null;
  tags: string[];
};

export type DrillGrading = {
  attemptId: string;
  correct: boolean;
  score: number | null;
  feedback: string;
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
  /** answer + distractors を固定順にシャッフルしたもの (表示用) */
  options: string[];
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

function fisherYatesShuffle<T>(array: T[], seed: string): T[] {
  // 決定的シャッフル (question.id を seed) でリロード時も同じ表示順を保つ
  const copy = array.slice();
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = copy.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [copy[i]!, copy[j]!] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export const useDrillStore = create<DrillState & Actions>((set) => ({
  phase: "idle",
  sessionId: null,
  question: null,
  options: [],
  selectedIndex: null,
  grading: null,
  summary: null,

  reset: () =>
    set({
      phase: "idle",
      sessionId: null,
      question: null,
      options: [],
      selectedIndex: null,
      grading: null,
      summary: null,
    }),

  setSession: (sessionId) => set({ sessionId, phase: "asking" }),

  setQuestion: (q) =>
    set(() => {
      if (!q) return { question: null, options: [], selectedIndex: null, phase: "asking" };
      const options = fisherYatesShuffle([q.answer, ...q.distractors], q.id);
      return {
        question: q,
        options,
        selectedIndex: null,
        grading: null,
        phase: "asking",
      };
    }),

  setSelected: (idx) => set({ selectedIndex: idx }),

  setGrading: (g) => set({ grading: g, phase: "graded" }),

  setSummary: (s) => set({ summary: s, phase: "finished" }),
}));
