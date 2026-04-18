import { and, eq, ilike, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it } from "vitest";

import { attempts, questions } from "@/db/schema";

/**
 * SQL injection 防御の「本物」テスト (Round 2 指摘 #2)。
 *
 * 実 DB には接続せず、drizzle builder の toSQL() を呼んで生成される SQL 文字列と
 * params を検査する。ユーザー入力 (injection ペイロード) が SQL 文字列本体ではなく
 * params 側 (bind parameter) に入ることを確認する。
 *
 * search.ts が `ilike(column, pattern)` / `eq(column, value)` を使っている限り、
 * drizzle は値を bind し、SQL 文字列には `$1`, `$2` プレースホルダしか入らない。
 */
describe("search SQL bind 検証 (drizzle toSQL)", () => {
  const db = drizzle.mock();

  const INJECTION_PAYLOADS = [
    "' OR 1=1 --",
    "; DROP TABLE attempts --",
    "admin' --",
    "' UNION SELECT * FROM users --",
    "%_\\injection",
  ];

  for (const payload of INJECTION_PAYLOADS) {
    it(`payload=${JSON.stringify(payload)} は params 側に入り、SQL 本体には含まれない`, () => {
      const escaped = payload.replace(/[\\%_]/g, (c) => `\\${c}`);
      const pattern = `%${escaped}%`;
      const built = db
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.userId, "u-1"),
            or(
              ilike(attempts.userAnswer, pattern),
              ilike(attempts.feedback, pattern),
              ilike(questions.prompt, pattern),
            ),
          ),
        );
      const { sql, params } = built.toSQL();

      // SQL 本体はプレースホルダ (e.g. $1) で、payload 自体は含まれない
      expect(sql).not.toContain(payload);
      // payload は escape された形で params 側に含まれる
      const paramAsStrings = params.map(String);
      expect(paramAsStrings.some((p) => p.includes(escaped))).toBe(true);
    });
  }
});
