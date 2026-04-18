import { inArray } from "drizzle-orm";

import { getDb } from "@/db/client";
import { concepts, type DifficultyLevel, type DomainId } from "@/db/schema";

/** Onboarding 診断テスト (issue #26) のデフォルト出題数 / clamp 上下限。
 *  seed が 10 concept しかない MVP 環境でも成立するよう低めに設定。
 *  docs/07.11 の「20 問」は内部上限とし、実数は available concepts に応じて clamp する。
 */
export const DIAGNOSTIC_DEFAULT_COUNT = 10;
export const DIAGNOSTIC_MIN_COUNT = 5;
export const DIAGNOSTIC_MAX_COUNT = 20;

type SelectArgs = {
  interestDomains: DomainId[];
  selfLevel: DifficultyLevel;
  count: number;
};

/** ユーザーが選んだ興味分野で、self_level を許容する concepts を均等に取得して
 *  「先頭から count 件」のキューにする。各 concept は session.next で
 *  pickDiagnosticConcept(queue, questionCount) によりラウンドロビン消費される
 *  (selectReviewCandidates / pickReviewConcept と同じ pattern)。
 *
 *  ストラテジ:
 *    1. interest_domains のいずれかに属する concept を取得
 *    2. self_level を difficulty_levels に含む concept のみ
 *    3. domain ごとにグループ化して round-robin (programming, dsa, ... の順番に 1 件ずつ拾う)
 *    4. 件数が count に満たない場合はループの先頭から再度拾う (concept 重複可)
 *    5. 0 件しか取れない場合は空配列を返す (呼び出し側で PRECONDITION_FAILED)
 */
export async function selectDiagnosticConcepts({
  interestDomains,
  selfLevel,
  count,
}: SelectArgs): Promise<string[]> {
  if (interestDomains.length === 0) return [];
  const rows = await getDb()
    .select({
      id: concepts.id,
      domainId: concepts.domainId,
      difficultyLevels: concepts.difficultyLevels,
    })
    .from(concepts)
    .where(inArray(concepts.domainId, interestDomains));

  // self_level を含む concept のみ採用 (空 difficulty_levels は CHECK 制約で排除済み)
  const eligible = rows.filter((r) => r.difficultyLevels.includes(selfLevel));
  if (eligible.length === 0) return [];

  // domain ごとにグループ化し、interest_domains の順番でラウンドロビン
  const groups = new Map<DomainId, string[]>();
  for (const d of interestDomains) groups.set(d, []);
  for (const r of eligible) {
    const arr = groups.get(r.domainId);
    if (arr) arr.push(r.id);
  }
  // 安定ソート: id 昇順 (テスト容易性)
  for (const arr of groups.values()) arr.sort();

  const queue: string[] = [];
  // round-robin で重複なく取れるだけ取る → 不足分は循環で重複出題
  // 例: domains=[programming, dsa] で programming=2 / dsa=1 / count=5 →
  //     [P0, D0, P1, P0, D0]  (P0/D0 が再出題されるのは MVP の許容)
  let exhausted = false;
  while (queue.length < count && !exhausted) {
    let pickedThisRound = 0;
    for (const d of interestDomains) {
      if (queue.length >= count) break;
      const arr = groups.get(d);
      if (!arr || arr.length === 0) continue;
      // ラウンド進行に応じて index を回す
      const round = Math.floor(queue.length / Math.max(interestDomains.length, 1));
      const idx = round % arr.length;
      queue.push(arr[idx]!);
      pickedThisRound += 1;
    }
    if (pickedThisRound === 0) exhausted = true;
  }
  return queue;
}

/** session.next で呼び出して conceptId を取り出す。空キューは呼び出し前に弾く想定 */
export function pickDiagnosticConcept(queue: string[], questionCount: number): string | null {
  if (queue.length === 0) return null;
  return queue[questionCount % queue.length] ?? null;
}
