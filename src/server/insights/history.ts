import { and, desc, eq, gte, inArray, isNull, lt, or, type SQL } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts, concepts, questions } from "@/db/schema";
import type { DomainId } from "@/db/schema/_constants";
import { jstPeriodBounds } from "@/lib/jst";

export type HistoryFilter = {
  /** 'all' | 'today' | 'week' */
  period?: "all" | "today" | "week";
  /** 'all' | 'correct' | 'partial' | 'wrong' */
  correctness?: "all" | "correct" | "partial" | "wrong";
  /** 分野 (domain ID) でフィルタ */
  domains?: string[];
  /** カーソル (createdAt ISO 文字列)。この時刻より古い attempt を取得 */
  cursor?: string;
  limit?: number;
};

/** 部分正解の閾値: score >= PARTIAL_MIN & < FULL_MIN を「部分正解」とする */
const PARTIAL_MIN_SCORE = 0.3;
const FULL_MIN_SCORE = 0.9;

export type HistoryItem = {
  attemptId: string;
  createdAt: Date;
  correct: boolean | null;
  score: number | null;
  feedback: string | null;
  questionId: string;
  questionPrompt: string;
  questionAnswer: string;
  userAnswer: string | null;
  questionType: string;
  difficulty: string;
  conceptId: string;
  conceptName: string;
  domainId: string;
  subdomainId: string;
};

export type HistoryResult = {
  items: HistoryItem[];
  /** 次ページがある場合、最後の attempt.createdAt ISO 文字列 */
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * History 画面 (issue #21, docs/05 §5.5) のデータ取得。
 * attempt を時系列降順で取得し、cursor (createdAt) ベースで pagination。
 * フィルタ: 期間 / 正誤 / 分野 (domain ID)。
 *
 * SQL injection 対策: 外部文字列は全て parametrized で投入 (drizzle の eq/gte/inArray は bind)。
 */
export async function fetchHistory(params: {
  userId: string;
  filter?: HistoryFilter;
}): Promise<HistoryResult> {
  const filter = params.filter ?? {};
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const preds: SQL[] = [eq(attempts.userId, params.userId)];

  // 期間は JST (Asia/Tokyo) 基準で「今日」と「今週 (直近 7 日 JST の 00:00 境界)」を算出
  // (Round 3 指摘: サーバがローカルタイムで判定していた)。
  if (filter.period === "today") {
    preds.push(gte(attempts.createdAt, jstPeriodBounds().today));
  } else if (filter.period === "week") {
    preds.push(gte(attempts.createdAt, jstPeriodBounds().weekAgo));
  }

  // 正誤: correct と score を組み合わせて correct / partial / wrong を判定 (Round 3 指摘)。
  // - correct: score >= FULL_MIN_SCORE (= 0.9) かつ correct=true
  // - partial: correct=true で score < FULL_MIN_SCORE、または correct=false で score >= PARTIAL_MIN_SCORE
  // - wrong:   上記以外 (correct=false かつ score < PARTIAL_MIN_SCORE、または correct=false & score=null)
  if (filter.correctness === "correct") {
    preds.push(and(eq(attempts.correct, true), gte(attempts.score, FULL_MIN_SCORE)) as SQL);
  } else if (filter.correctness === "partial") {
    preds.push(
      or(
        and(eq(attempts.correct, true), lt(attempts.score, FULL_MIN_SCORE)) as SQL,
        and(eq(attempts.correct, false), gte(attempts.score, PARTIAL_MIN_SCORE)) as SQL,
      ) as SQL,
    );
  } else if (filter.correctness === "wrong") {
    preds.push(
      and(
        eq(attempts.correct, false),
        or(lt(attempts.score, PARTIAL_MIN_SCORE), isNull(attempts.score)) as SQL,
      ) as SQL,
    );
  }
  // "all" および undefined は追加 predicate なし

  // 分野 (domain) は concepts.domainId で絞る。conceptId で attempts を絞り込むため、
  // 対象 domain の concept id を先に取得し、attempts.conceptId IN (...) で渡す。
  if (filter.domains && filter.domains.length > 0) {
    const conceptIds = await getDb()
      .select({ id: concepts.id })
      .from(concepts)
      .where(inArray(concepts.domainId, filter.domains as DomainId[]));
    const ids = conceptIds.map((r) => r.id);
    if (ids.length === 0) {
      return { items: [], nextCursor: null };
    }
    preds.push(inArray(attempts.conceptId, ids));
  }

  // cursor: "{ISO}|{attemptId}" の複合キーで同秒 tie-break まで安定。
  // 後方互換のため "{ISO}" 単独入力は従来通り (createdAt 未満) として扱う。
  if (filter.cursor) {
    const [cursorIso, cursorId] = filter.cursor.split("|");
    const cursorDate = cursorIso ? new Date(cursorIso) : null;
    if (cursorDate && !Number.isNaN(cursorDate.getTime())) {
      if (cursorId) {
        // createdAt < c OR (createdAt = c AND id < cursorId)
        preds.push(
          or(
            lt(attempts.createdAt, cursorDate),
            and(eq(attempts.createdAt, cursorDate), lt(attempts.id, cursorId)) as SQL,
          ) as SQL,
        );
      } else {
        preds.push(lt(attempts.createdAt, cursorDate));
      }
    }
  }

  const rows = await getDb()
    .select({
      attemptId: attempts.id,
      createdAt: attempts.createdAt,
      correct: attempts.correct,
      score: attempts.score,
      feedback: attempts.feedback,
      userAnswer: attempts.userAnswer,
      questionId: questions.id,
      questionPrompt: questions.prompt,
      questionAnswer: questions.answer,
      questionType: questions.type,
      difficulty: questions.difficulty,
      conceptId: concepts.id,
      conceptName: concepts.name,
      domainId: concepts.domainId,
      subdomainId: concepts.subdomainId,
    })
    .from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .innerJoin(concepts, eq(attempts.conceptId, concepts.id))
    .where(and(...preds))
    // createdAt 降順 + attemptId 降順の複合 sort で同秒 tie-break まで安定化。
    .orderBy(desc(attempts.createdAt), desc(attempts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  // nextCursor は複合キー形式 "{ISO}|{attemptId}" で返し、次ページで正確に続きが取れるように。
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}|${last.attemptId}` : null;

  return { items, nextCursor };
}
