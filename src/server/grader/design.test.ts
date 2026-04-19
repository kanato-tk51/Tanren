import { describe, expect, it } from "vitest";

import type { DialogueTurn } from "@/db/schema";

import {
  buildDesignPrompt,
  countAiTurns,
  DESIGN_MAX_AI_TURNS,
  designRubricChecks,
  runDesignTurn,
  type DesignLlmCaller,
  type DesignResponse,
} from "./design";

function turn(role: "ai" | "user", message: string): DialogueTurn {
  return { role, message, at: "2026-04-19T00:00:00Z" };
}

describe("countAiTurns", () => {
  it("role === 'ai' のみをカウント", () => {
    expect(countAiTurns([])).toBe(0);
    expect(countAiTurns([turn("user", "a")])).toBe(0);
    expect(countAiTurns([turn("ai", "q1"), turn("user", "a1"), turn("ai", "q2")])).toBe(2);
  });
});

describe("buildDesignPrompt", () => {
  it("turnCount < MAX-1 は forceFinalize=false", () => {
    const p = buildDesignPrompt({
      question: { prompt: "URL 短縮サービスを設計" },
      initialUserAnswer: "hash を URL 化",
      turns: [],
    });
    expect(p.forceFinalize).toBe(false);
    expect(p.turnCount).toBe(0);
    expect(p.system).toMatch(/途中/);
    expect(p.user).toMatch(/hash を URL 化/);
    expect(p.user).toMatch(/turnCount=0/);
  });

  it("turnCount === MAX-1 は forceFinalize=true (最終ターン)", () => {
    const p = buildDesignPrompt({
      question: { prompt: "短縮 URL" },
      initialUserAnswer: "base62",
      turns: [turn("ai", "Q1"), turn("user", "A1"), turn("ai", "Q2"), turn("user", "A2")],
    });
    expect(p.forceFinalize).toBe(true);
    expect(p.turnCount).toBe(DESIGN_MAX_AI_TURNS - 1);
    expect(p.system).toMatch(/最終ターン/);
  });
});

describe("runDesignTurn", () => {
  it("正常系: LLM 応答を response に包んで返す (fallback=false)", async () => {
    const llm: DesignLlmCaller = async () => ({
      finalized: false,
      nextQuestion: "具体的な QPS は?",
      score: null,
      feedback: null,
      rubricChecks: null,
    });
    const out = await runDesignTurn(
      {
        question: { prompt: "x" },
        initialUserAnswer: "y",
        turns: [],
      },
      llm,
    );
    expect(out.fallback).toBe(false);
    expect(out.response.finalized).toBe(false);
    expect(out.response.nextQuestion).toBe("具体的な QPS は?");
    expect(out.model).toBe("gpt-5");
  });

  it("forceFinalize のときに LLM が finalized=false を返したら強制確定 (fallback=false)", async () => {
    const llm: DesignLlmCaller = async () => ({
      finalized: false,
      nextQuestion: "さらに聞きたい",
      score: null,
      feedback: null,
      rubricChecks: null,
    });
    const out = await runDesignTurn(
      {
        question: { prompt: "x" },
        initialUserAnswer: "y",
        turns: [turn("ai", "q1"), turn("user", "a1"), turn("ai", "q2"), turn("user", "a2")],
      },
      llm,
    );
    expect(out.response.finalized).toBe(true);
    expect(out.response.nextQuestion).toBeNull();
    expect(out.response.score).toBe(0.5); // fallback within the prompt
    expect(out.fallback).toBe(false); // LLM 応答は返ってきたので fallback=false
  });

  it("LLM throw 時は fallback=true + 中間点で safe finalize", async () => {
    const llm: DesignLlmCaller = async () => {
      throw new Error("LLM broke");
    };
    const out = await runDesignTurn(
      { question: { prompt: "x" }, initialUserAnswer: "y", turns: [] },
      llm,
    );
    expect(out.fallback).toBe(true);
    expect(out.response.finalized).toBe(true);
    expect(out.response.score).toBe(0.4);
    expect(out.response.feedback).toMatch(/壊れ/);
  });
});

describe("designRubricChecks", () => {
  it("null rubric は空配列、comment なしは空文字で埋める", () => {
    const r: DesignResponse = {
      finalized: true,
      nextQuestion: null,
      score: 0.7,
      feedback: "ok",
      rubricChecks: null,
    };
    expect(designRubricChecks(r)).toEqual([]);
    const r2: DesignResponse = {
      finalized: true,
      nextQuestion: null,
      score: 0.7,
      feedback: "ok",
      rubricChecks: [{ id: "scale", passed: true }],
    };
    expect(designRubricChecks(r2)).toEqual([{ id: "scale", passed: true, comment: "" }]);
  });
});
