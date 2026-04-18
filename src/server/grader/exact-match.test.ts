import { describe, expect, it } from "vitest";

import type { Question } from "@/db/schema";

import { gradeExactMatch } from "./exact-match";

function q(answer: string, type: Question["type"] = "cloze") {
  return { answer, type } as Pick<Question, "answer" | "type">;
}

describe("gradeExactMatch", () => {
  it("完全一致は correct=true / score=1", () => {
    const r = gradeExactMatch(q("42"), "42");
    expect(r.correct).toBe(true);
    expect(r.score).toBe(1);
  });

  it("trim で前後空白を無視", () => {
    expect(gradeExactMatch(q("race condition"), "  race condition  ").correct).toBe(true);
  });

  it("全角英数字は NFKC で半角に正規化して比較", () => {
    expect(gradeExactMatch(q("ABC123"), "ＡＢＣ１２３").correct).toBe(true);
  });

  it("連続空白は 1 個に圧縮 (タブ / 全角スペース含む)", () => {
    expect(gradeExactMatch(q("a b"), "a   b").correct).toBe(true);
    expect(gradeExactMatch(q("a b"), "a\tb").correct).toBe(true);
    expect(gradeExactMatch(q("a b"), "a\u3000b").correct).toBe(true);
  });

  it("行頭行末の空白と CRLF → LF の違いは吸収、改行自体は保持", () => {
    expect(gradeExactMatch(q("line1\nline2"), "line1\r\nline2").correct).toBe(true);
    expect(gradeExactMatch(q("line1\nline2"), " line1 \n line2 ").correct).toBe(true);
  });

  it("case sensitive (code_read は大文字小文字重要)", () => {
    expect(gradeExactMatch(q("Hello", "code_read"), "hello").correct).toBe(false);
  });

  it("不一致は correct=false / score=0、正解を feedback に含める", () => {
    const r = gradeExactMatch(q("42"), "43");
    expect(r.correct).toBe(false);
    expect(r.score).toBe(0);
    expect(r.feedback).toContain("42");
  });
});
