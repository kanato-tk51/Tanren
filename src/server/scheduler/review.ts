import { and, desc, eq, gte } from "drizzle-orm";

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

  // 直近の誤答を時刻降順で十分な余裕 (count * 4) 件取得し、concept 別に最新 1 件ずつに dedupe
  const wrongRows = await db
    .select({
      conceptId: attempts.conceptId,
      createdAt: attempts.createdAt,
    })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, params.userId),
        eq(attempts.correct, false),
        gte(attempts.createdAt, since),
      ),
    )
    .orderBy(desc(attempts.createdAt))
    .limit(count * 4);

  const latestByConcept = new Map<string, Date>();
  for (const r of wrongRows) {
    if (!latestByConcept.has(r.conceptId)) {
      latestByConcept.set(r.conceptId, r.createdAt);
    }
  }

  const conceptIds = Array.from(latestByConcept.keys()).slice(0, count);
  if (conceptIds.length === 0) return [];

  // concept 情報を一括ロード (Map で O(1) lookup)
  const conceptRows = await db.select().from(concepts);
  const conceptById = new Map(conceptRows.map((c) => [c.id, c]));

  const out: ReviewCandidate[] = [];
  for (const id of conceptIds) {
    const c = conceptById.get(id);
    const latest = latestByConcept.get(id);
    if (c && latest) out.push({ concept: c, latestWrongAt: latest });
  }
  return out;
}
