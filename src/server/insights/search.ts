import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts, concepts, misconceptions, questions } from "@/db/schema";

export type SearchResult = {
  hits: Array<{
    attemptId: string;
    createdAt: Date;
    questionPrompt: string;
    userAnswer: string | null;
    feedback: string | null;
    correct: boolean | null;
    score: number | null;
    conceptId: string;
    conceptName: string;
    domainId: string;
    subdomainId: string;
    /** この行に実際に q がヒットした source。questions/attempts/misconceptions のどれか */
    hitSource: "question" | "userAnswer" | "feedback" | "misconception";
  }>;
  /** ドメインごとの hit 集計 (受け入れ基準「検索結果にドメインごとの hit 集計」) */
  domainHits: Array<{ domainId: string; count: number }>;
};

/**
 * 簡易全文検索 (issue #22, docs/05 §5.6)。
 * MVP では ILIKE '%q%' を attempts / questions / misconceptions に投げ、concept で集約する。
 * pg_trgm / tsvector 本格チューニングは Phase 5+ (issue #30)。
 *
 * SQL injection 対策: drizzle の ilike() / eq() は prepared statement で bind されるため、
 * 外部文字列 (q) はプレースホルダ経由で安全。`%` `_` などの LIKE ワイルドカード文字は
 * エスケープしない (ユーザーの意図した部分一致を優先)。
 */
export async function fetchSearch(params: {
  userId: string;
  q: string;
  limit?: number;
}): Promise<SearchResult> {
  const q = params.q.trim();
  if (q.length === 0) return { hits: [], domainHits: [] };
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const pattern = `%${q}%`;
  const db = getDb();

  // attempts.user_answer / attempts.feedback に部分一致したもの
  const attemptHits = await db
    .select({
      attemptId: attempts.id,
      createdAt: attempts.createdAt,
      userAnswer: attempts.userAnswer,
      feedback: attempts.feedback,
      correct: attempts.correct,
      score: attempts.score,
      questionPrompt: questions.prompt,
      conceptId: concepts.id,
      conceptName: concepts.name,
      domainId: concepts.domainId,
      subdomainId: concepts.subdomainId,
      ua: attempts.userAnswer,
      fb: attempts.feedback,
      qp: questions.prompt,
    })
    .from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .innerJoin(concepts, eq(attempts.conceptId, concepts.id))
    .where(
      and(
        eq(attempts.userId, params.userId),
        or(
          ilike(attempts.userAnswer, pattern),
          ilike(attempts.feedback, pattern),
          ilike(questions.prompt, pattern),
        ) as SQL,
      ),
    )
    .orderBy(desc(attempts.createdAt))
    .limit(limit);

  // misconceptions.description に部分一致したもの (attempt は未紐付け)
  const miscHits = await db
    .select({
      id: misconceptions.id,
      description: misconceptions.description,
      conceptId: concepts.id,
      conceptName: concepts.name,
      domainId: concepts.domainId,
      subdomainId: concepts.subdomainId,
      lastSeen: misconceptions.lastSeen,
    })
    .from(misconceptions)
    .innerJoin(concepts, eq(misconceptions.conceptId, concepts.id))
    .where(
      and(eq(misconceptions.userId, params.userId), ilike(misconceptions.description, pattern)),
    )
    .orderBy(desc(misconceptions.lastSeen))
    .limit(limit);

  const hits: SearchResult["hits"] = [];
  for (const r of attemptHits) {
    const matchedInUserAnswer = r.ua !== null && containsIgnoreCase(r.ua, q);
    const matchedInFeedback = r.fb !== null && containsIgnoreCase(r.fb, q);
    const hitSource: SearchResult["hits"][number]["hitSource"] = matchedInUserAnswer
      ? "userAnswer"
      : matchedInFeedback
        ? "feedback"
        : "question";
    hits.push({
      attemptId: r.attemptId,
      createdAt: r.createdAt,
      questionPrompt: r.questionPrompt,
      userAnswer: r.userAnswer,
      feedback: r.feedback,
      correct: r.correct,
      score: r.score,
      conceptId: r.conceptId,
      conceptName: r.conceptName,
      domainId: r.domainId,
      subdomainId: r.subdomainId,
      hitSource,
    });
  }
  for (const m of miscHits) {
    // misconception 由来の hit は attempt id を持たないため、疑似 id を "misc-{id}" で返す。
    hits.push({
      attemptId: `misc-${m.id}`,
      createdAt: m.lastSeen,
      questionPrompt: m.description,
      userAnswer: null,
      feedback: null,
      correct: null,
      score: null,
      conceptId: m.conceptId,
      conceptName: m.conceptName,
      domainId: m.domainId,
      subdomainId: m.subdomainId,
      hitSource: "misconception",
    });
  }
  hits.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // ドメインごとの hit 集計
  const byDomain = new Map<string, number>();
  for (const h of hits) {
    byDomain.set(h.domainId, (byDomain.get(h.domainId) ?? 0) + 1);
  }
  const domainHits = Array.from(byDomain.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([domainId, count]) => ({ domainId, count }));

  return { hits, domainHits };
}

function containsIgnoreCase(text: string, q: string): boolean {
  return text.toLowerCase().includes(q.toLowerCase());
}

/** 関連 SQL: `sql` は現在使っていないが将来 tsvector 移行 (#30) 時に再利用する想定で保持 */
void sql;
