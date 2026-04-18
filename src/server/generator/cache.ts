import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  questions,
  type DifficultyLevel,
  type Question,
  type QuestionType,
  type ThinkingStyle,
} from "@/db/schema";

export type CacheLookupInput = {
  conceptId: string;
  type: QuestionType;
  thinkingStyle: ThinkingStyle | null;
  difficulty: DifficultyLevel;
  /** 直近 N 日 (default 30) の生成済みから返す */
  recentDays?: number;
};

/**
 * docs/03-ai-strategy.md §3.3.1 のキャッシュ検索。
 * 同じ (concept, type, style, difficulty) の問題で、retired=false かつ
 * 直近 N 日以内に生成されていて、serve_count が少ない順に 1 件返す。
 * 「未使用を優先」するため last_served_at が null のものを先に。
 */
export async function findCachedQuestion(
  db: Db,
  input: CacheLookupInput,
): Promise<Question | null> {
  const windowDays = input.recentDays ?? 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const predicates = [
    eq(questions.conceptId, input.conceptId),
    eq(questions.type, input.type),
    eq(questions.difficulty, input.difficulty),
    eq(questions.retired, false),
    gte(questions.createdAt, since),
  ];
  predicates.push(
    input.thinkingStyle === null
      ? isNull(questions.thinkingStyle)
      : eq(questions.thinkingStyle, input.thinkingStyle),
  );

  const rows = await db
    .select()
    .from(questions)
    .where(and(...predicates))
    // 未使用 (last_served_at IS NULL) を優先、次に使用回数が少ない順
    .orderBy(
      sql`${questions.lastServedAt} IS NULL DESC`,
      questions.serveCount,
      desc(questions.createdAt),
    )
    .limit(1);

  return rows[0] ?? null;
}
