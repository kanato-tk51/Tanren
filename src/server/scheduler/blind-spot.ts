import type { Concept } from "@/db/schema";

/**
 * Blind spot 判定の共有ヘルパ。
 * 「prereqs が空、または全ての prereq が masteredIds に含まれる」なら true。
 * Daily Drill (scheduler/daily.ts) と Insights Overview (insights/overview.ts) の
 * 両方で使い、定義がずれないようにする (issue #20 Round 3 指摘)。
 */
export function arePrereqsSatisfied(concept: Concept, masteredIds: Set<string>): boolean {
  const prereqs = concept.prereqs ?? [];
  return prereqs.length === 0 || prereqs.every((id) => masteredIds.has(id));
}
