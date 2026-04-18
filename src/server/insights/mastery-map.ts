import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { attempts, concepts, mastery, type Concept, type Mastery } from "@/db/schema";

/** Mastery tier の 4 段階 (docs/05 §5.4)。 */
export const MASTERY_TIERS = ["untouched", "weak", "mid", "mastered"] as const;
export type MasteryTier = (typeof MASTERY_TIERS)[number];

/** mastery_pct と attempt_count から tier を決める。docs/05 §5.4:
 *  - 灰 (untouched): 未着手 (attempt_count === 0)
 *  - 赤 (weak): mastery < 40%
 *  - 黄 (mid): 40-80%
 *  - 緑 (mastered): 80%+
 */
export function toMasteryTier(args: { masteryPct: number; attemptCount: number }): MasteryTier {
  if (args.attemptCount <= 0) return "untouched";
  if (args.masteryPct < 0.4) return "weak";
  if (args.masteryPct < 0.8) return "mid";
  return "mastered";
}

export type MapConceptNode = {
  conceptId: string;
  conceptName: string;
  masteryPct: number;
  attemptCount: number;
  tier: MasteryTier;
};

export type MapSubdomainNode = {
  subdomainId: string;
  /** 配下 concept の attemptCount 合計 */
  attemptCount: number;
  /** 配下 concept の masteryPct 平均 (attempt>0 のみ対象、全部 0 なら 0) */
  masteryPct: number;
  concepts: MapConceptNode[];
};

export type MapDomainNode = {
  domainId: string;
  attemptCount: number;
  masteryPct: number;
  subdomains: MapSubdomainNode[];
};

export type MasteryMap = {
  /** 全 concept の attemptCount 合計 (sunburst の面積正規化の分母に使う) */
  totalAttempts: number;
  domains: MapDomainNode[];
};

function weightedAverage(items: Array<{ masteryPct: number; attemptCount: number }>): number {
  const seen = items.filter((x) => x.attemptCount > 0);
  if (seen.length === 0) return 0;
  return seen.reduce((a, x) => a + x.masteryPct, 0) / seen.length;
}

/** Mastery Map (issue #29) の hierarchical 集計。
 *  Insights overview と同じ 3 テーブル結合を使うが、Top N ではなく「全 concept を
 *  domain → subdomain → concept 階層に入れて丸ごと返す」形にする。
 *  Recharts / D3 を入れずクライアント SVG で描画する前提で、UI 側が必要とするだけの
 *  (id, name, pct, count) を最小形で返す。
 */
export async function fetchMasteryMap(userId: string): Promise<MasteryMap> {
  const db = getDb();
  const conceptRows: Concept[] = await db.select().from(concepts);
  const masteryRows: Mastery[] = await db.select().from(mastery).where(eq(mastery.userId, userId));
  const attemptCountRows = await db
    .select({
      conceptId: attempts.conceptId,
      total: sql<number>`count(*)::int`.as("total"),
    })
    .from(attempts)
    .where(eq(attempts.userId, userId))
    .groupBy(attempts.conceptId);

  const masteryByConcept = new Map(masteryRows.map((m) => [m.conceptId, m]));
  const attemptCountByConcept = new Map(attemptCountRows.map((r) => [r.conceptId, r.total ?? 0]));

  const conceptNodes: MapConceptNode[] = conceptRows.map((c) => {
    const m = masteryByConcept.get(c.id);
    const attemptCount = attemptCountByConcept.get(c.id) ?? 0;
    const masteryPct = m ? m.masteryPct : 0;
    return {
      conceptId: c.id,
      conceptName: c.name,
      masteryPct,
      attemptCount,
      tier: toMasteryTier({ masteryPct, attemptCount }),
    };
  });

  // domain → subdomain → concepts の 2 段 grouping。stable sort を保つために
  // id 昇順で sort (UI 側の色配置が不安定にならないように決定論を優先)。
  const byDomainSub = new Map<string, Map<string, MapConceptNode[]>>();
  const conceptMeta = new Map(conceptRows.map((c) => [c.id, c]));
  for (const cn of conceptNodes) {
    const meta = conceptMeta.get(cn.conceptId);
    if (!meta) continue;
    const dmap = byDomainSub.get(meta.domainId) ?? new Map<string, MapConceptNode[]>();
    const list = dmap.get(meta.subdomainId) ?? [];
    list.push(cn);
    dmap.set(meta.subdomainId, list);
    byDomainSub.set(meta.domainId, dmap);
  }

  const domains: MapDomainNode[] = [...byDomainSub.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domainId, subMap]) => {
      const subdomains: MapSubdomainNode[] = [...subMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([subdomainId, cs]) => {
          const list = cs.slice().sort((a, b) => a.conceptId.localeCompare(b.conceptId));
          const attemptCount = list.reduce((a, x) => a + x.attemptCount, 0);
          return {
            subdomainId,
            concepts: list,
            attemptCount,
            masteryPct: weightedAverage(list),
          };
        });
      const attemptCount = subdomains.reduce((a, x) => a + x.attemptCount, 0);
      const allConcepts = subdomains.flatMap((s) => s.concepts);
      return {
        domainId,
        subdomains,
        attemptCount,
        masteryPct: weightedAverage(allConcepts),
      };
    });

  const totalAttempts = domains.reduce((a, d) => a + d.attemptCount, 0);
  return { totalAttempts, domains };
}
