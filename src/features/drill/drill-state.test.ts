import { describe, it, expect, beforeEach } from "vitest";

import { useDrillStore, type DrillQuestion } from "./drill-state";

const sampleQuestion: DrillQuestion = {
  id: "q-1",
  prompt: "HTTP の PUT と PATCH の違いは?",
  options: [
    "PUT は body 不要",
    "PUT は冪等、PATCH は部分更新",
    "両方とも冪等",
    "PATCH はキャッシュされる",
  ],
  hint: null,
  tags: ["rest"],
  meta: null,
};

describe("useDrillStore", () => {
  beforeEach(() => {
    useDrillStore.getState().reset();
  });

  it("初期状態は idle", () => {
    const s = useDrillStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.sessionId).toBe(null);
    expect(s.question).toBe(null);
  });

  it("setSession で asking に遷移", () => {
    useDrillStore.getState().setSession("s-1");
    expect(useDrillStore.getState().phase).toBe("asking");
    expect(useDrillStore.getState().sessionId).toBe("s-1");
  });

  it("setQuestion で options がサーバー由来のまま入る (クライアントで再シャッフルしない)", () => {
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setQuestion(sampleQuestion);
    expect(useDrillStore.getState().question?.options).toEqual(sampleQuestion.options);
  });

  it("setSelected で選択インデックス保持", () => {
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setQuestion(sampleQuestion);
    useDrillStore.getState().setSelected(2);
    expect(useDrillStore.getState().selectedIndex).toBe(2);
  });

  it("setGrading で graded に遷移、correctIndex を保持", () => {
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setQuestion(sampleQuestion);
    useDrillStore.getState().setGrading({
      attemptId: "a-1",
      correct: true,
      score: 1,
      feedback: "正解です",
      correctIndex: 1,
      questionType: "mcq",
      correctAnswer: "正解の文言",
      userAnswer: "選んだ文言",
    });
    const s = useDrillStore.getState();
    expect(s.phase).toBe("graded");
    expect(s.grading?.correctIndex).toBe(1);
  });

  it("setSummary で finished に遷移", () => {
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setSummary({ questionCount: 5, correctCount: 4, accuracy: 0.8 });
    expect(useDrillStore.getState().phase).toBe("finished");
    expect(useDrillStore.getState().summary?.accuracy).toBe(0.8);
  });

  it("reset で idle に戻る", () => {
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setQuestion(sampleQuestion);
    useDrillStore.getState().reset();
    expect(useDrillStore.getState().phase).toBe("idle");
    expect(useDrillStore.getState().sessionId).toBe(null);
    expect(useDrillStore.getState().question).toBe(null);
  });
});
