import { describe, it, expect, beforeEach } from "vitest";

import { useDrillStore } from "./drill-state";

const sampleQuestion = {
  id: "q-1",
  prompt: "HTTP の PUT と PATCH の違いは?",
  answer: "PUT は冪等、PATCH は部分更新",
  distractors: ["PUT は body 不要", "PATCH はキャッシュされる", "両方とも冪等"],
  hint: null,
  tags: ["rest"],
};

describe("useDrillStore", () => {
  beforeEach(() => {
    useDrillStore.getState().reset();
  });

  it("初期状態は idle / sessionId=null", () => {
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

  it("setQuestion で options (answer + distractors 4 件) が設定される", () => {
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setQuestion(sampleQuestion);
    const s = useDrillStore.getState();
    expect(s.options).toHaveLength(4);
    expect(s.options).toContain(sampleQuestion.answer);
    sampleQuestion.distractors.forEach((d) => expect(s.options).toContain(d));
    expect(s.selectedIndex).toBe(null);
  });

  it("同じ question.id なら決定的にシャッフルされる (リロードで順序が変わらない)", () => {
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setQuestion(sampleQuestion);
    const first = useDrillStore.getState().options.slice();
    useDrillStore.getState().reset();
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setQuestion(sampleQuestion);
    const second = useDrillStore.getState().options;
    expect(second).toEqual(first);
  });

  it("setGrading で graded に遷移", () => {
    useDrillStore.getState().setSession("s-1");
    useDrillStore.getState().setQuestion(sampleQuestion);
    useDrillStore.getState().setGrading({
      attemptId: "a-1",
      correct: true,
      score: 1,
      feedback: "正解です",
    });
    expect(useDrillStore.getState().phase).toBe("graded");
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
