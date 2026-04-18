import { describe, it, expect, beforeEach } from "vitest";

import { normalizeRubricChecks, useDrillStore, type DrillQuestion } from "./drill-state";

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
      rubricChecks: [],
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

  it("updateGrading で rubricChecks を rebut 経由で差し替えられる (回帰テスト)", () => {
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setQuestion(sampleQuestion);
    useDrillStore.getState().setGrading({
      attemptId: "a-1",
      correct: false,
      score: 0.4,
      feedback: "旧判定",
      correctIndex: null,
      questionType: "short",
      correctAnswer: "A",
      userAnswer: "B",
      rubricChecks: [{ id: "r1", passed: false, comment: "旧 comment" }],
    });
    useDrillStore.getState().updateGrading({
      correct: true,
      score: 0.9,
      feedback: "新判定",
      rebutted: true,
      rubricChecks: normalizeRubricChecks([{ id: "r1", passed: true, comment: "反論後に合格" }]),
    });
    const s = useDrillStore.getState();
    expect(s.grading?.correct).toBe(true);
    expect(s.grading?.rebutted).toBe(true);
    expect(s.grading?.rubricChecks).toEqual([{ id: "r1", passed: true, comment: "反論後に合格" }]);
  });
});

describe("normalizeRubricChecks", () => {
  it("null / undefined は空配列", () => {
    expect(normalizeRubricChecks(null)).toEqual([]);
    expect(normalizeRubricChecks(undefined)).toEqual([]);
  });

  it("comment null は空文字に正規化", () => {
    expect(normalizeRubricChecks([{ id: "r1", passed: true, comment: null }])).toEqual([
      { id: "r1", passed: true, comment: "" },
    ]);
  });

  it("通常入力は素通し", () => {
    expect(normalizeRubricChecks([{ id: "r1", passed: false, comment: "足りない" }])).toEqual([
      { id: "r1", passed: false, comment: "足りない" },
    ]);
  });
});
