import { and, desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts, concepts, type Concept } from "@/db/schema";

/**
 * Mistake Review モード (issue #23, docs/02 §2.6)。
 * 直近 N 日の誤答 (correct=false) から、concept 別に最新の誤答 1 件ずつを拾い上げ、
 * 上位 count 件の concept を返す。同 concept で連発していても 1 件に集約して、
 * 異なる concept 群をカバーする形で出題候補を多様化する。
 */

export const REVIEW_DEFAULT_DAYS = 14;
export const REVIEW_DEFAULT_COUNT = 10;
export const REVIEW_MAX_COUNT = 15;

/**
 * session.next が `reviewConceptIds` から次に出題する concept を選ぶロジック。
 * `session.questionCount` をインデックスとしたラウンドロビン (空キューは null)。
 * 別モジュールから import してテストできるよう切り出し (issue #23 Round 4 指摘)。
 */
export function pickReviewConcept(
  queue: readonly string[] | null | undefined,
  questionCount: number,
): string | null {
  if (!queue || queue.length === 0) return null;
  return queue[questionCount % queue.length] ?? null;
}

export type ReviewCandidate = {
  concept: Concept;
  /** 最新の誤答 attempt の createdAt (concept ランキングの降順キー) */
  latestWrongAt: Date;
};

export async function selectReviewCandidates(params: {
  userId: string;
  count?: number;
  days?: number;
  now?: Date;
}): Promise<ReviewCandidate[]> {
  const count = Math.min(Math.max(params.count ?? REVIEW_DEFAULT_COUNT, 1), REVIEW_MAX_COUNT);
  const days = Math.max(params.days ?? REVIEW_DEFAULT_DAYS, 1);
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const db = getDb();

  // concept 別に最新の誤答を集約。DISTINCT ON を使わず GROUP BY で全ユニーク concept を取得し、
  // 誤答時刻の最新降順で count 件に絞る。`count * 4` ヒューリスティックで取りこぼす問題を解消
  // (Round 1 指摘 #2)。
  const groupedRows = await db
    .select({
      conceptId: attempts.conceptId,
      latest: sql<Date>`max(${attempts.createdAt})`.as("latest"),
    })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, params.userId),
        eq(attempts.correct, false),
        gte(attempts.createdAt, since),
      ),
    )
    .groupBy(attempts.conceptId)
    .orderBy(desc(sql`max(${attempts.createdAt})`))
    .limit(count);

  if (groupedRows.length === 0) return [];

  // concept 情報を一括ロード (Map で O(1) lookup)
  const conceptRows = await db.select().from(concepts);
  const conceptById = new Map(conceptRows.map((c) => [c.id, c]));

  const out: ReviewCandidate[] = [];
  for (const r of groupedRows) {
    const c = conceptById.get(r.conceptId);
    if (c) {
      // driver によっては max(timestamp) が string で返るため Date() で正規化
      const latestWrongAt = r.latest instanceof Date ? r.latest : new Date(r.latest);
      out.push({ concept: c, latestWrongAt });
    }
  }
  return out;
}
