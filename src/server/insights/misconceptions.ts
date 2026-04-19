import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { concepts, misconceptions } from "@/db/schema";

export type MisconceptionItem = {
  id: string;
  description: string;
  conceptId: string;
  conceptName: string;
  domainId: string;
  subdomainId: string;
  count: number;
  resolved: boolean;
  firstSeen: Date;
  lastSeen: Date;
};

export type MisconceptionsList = {
  active: MisconceptionItem[];
  resolved: MisconceptionItem[];
};

/** Misconception Tracker (issue #38, docs/05 §5.8)。
 *  active と resolved を分けて返す。active は count 降順、resolved は lastSeen 降順。
 */
export async function fetchMisconceptions(userId: string): Promise<MisconceptionsList> {
  const rows = await getDb()
    .select({
      id: misconceptions.id,
      description: misconceptions.description,
      conceptId: concepts.id,
      conceptName: concepts.name,
      domainId: concepts.domainId,
      subdomainId: concepts.subdomainId,
      count: misconceptions.count,
      resolved: misconceptions.resolved,
      firstSeen: misconceptions.firstSeen,
      lastSeen: misconceptions.lastSeen,
    })
    .from(misconceptions)
    .innerJoin(concepts, eq(concepts.id, misconceptions.conceptId))
    .where(eq(misconceptions.userId, userId))
    .orderBy(desc(misconceptions.count), desc(misconceptions.lastSeen));

  const active = rows.filter((r) => !r.resolved);
  const resolved = rows
    .filter((r) => r.resolved)
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  return { active, resolved };
}

/** 誤概念を resolved=true に flag (ユーザー操作による明示解決、issue #38) */
export async function markMisconceptionResolved(args: {
  userId: string;
  id: string;
}): Promise<void> {
  await getDb()
    .update(misconceptions)
    .set({ resolved: true })
    .where(and(eq(misconceptions.id, args.id), eq(misconceptions.userId, args.userId)));
}
