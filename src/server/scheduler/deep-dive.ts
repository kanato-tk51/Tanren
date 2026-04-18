import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { concepts, DIFFICULTY_LEVELS, type DifficultyLevel, type DomainId } from "@/db/schema";

export const DEEP_DIVE_DEFAULT_COUNT = 12;
export const DEEP_DIVE_MIN_COUNT = 10;
export const DEEP_DIVE_MAX_COUNT = 15;

/** Deep Dive キューの 1 ステップ (docs/02 §2.6.2)。 */
export type DeepStep = { conceptId: string; difficulty: DifficultyLevel };

type SelectArgs = {
  domainId: DomainId;
  count: number;
};

/** difficulty_levels を DIFFICULTY_LEVELS 順 (beginner..principal) に sort */
function sortedDifficulties(levels: DifficultyLevel[]): DifficultyLevel[] {
  const order = new Map(DIFFICULTY_LEVELS.map((lvl, i) => [lvl, i] as const));
  return [...levels].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

/** Kahn 法での topological sort。同レベル内は concept.id 昇順で stable に並べる。
 *  prereqs に domain 外 concept がある場合は「外部 prereq はとりあえず満たされている」と仮定して
 *  domain 内 graph を構築する (docs/02 は「ドメイン内で閉じる」と明言していないが、
 *  1 domain 集中学習の目的に照らすと外部依存を全部解決していない状態でも動かしたい)。
 *  prereq 循環があれば残った concept は後ろに id 順で積む (MVP、seed は循環を認めない前提)。
 */
export function topoSortByPrereqs(rows: Array<{ id: string; prereqs: string[] | null }>): string[] {
  const ids = new Set(rows.map((r) => r.id));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const r of rows) {
    indeg.set(r.id, 0);
    adj.set(r.id, []);
  }
  for (const r of rows) {
    for (const p of r.prereqs ?? []) {
      if (!ids.has(p)) continue; // domain 外 prereq は無視
      adj.get(p)!.push(r.id);
      indeg.set(r.id, (indeg.get(r.id) ?? 0) + 1);
    }
  }
  const queue: string[] = [...indeg.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort(); // 決定論
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) {
        // insertion sort で決定論を保つ
        const pos = queue.findIndex((x) => x > next);
        if (pos < 0) queue.push(next);
        else queue.splice(pos, 0, next);
      }
    }
  }
  // 循環があれば未処理 concept を id 順で末尾に積む (MVP 安全網)
  for (const id of ids) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** domain 内 concept を prereqs → difficulty 昇順で並べて、最大 count 件のキューを作る。
 *  docs/02 §2.6.2: 指定ドメインの concept を prereqs 順にトポロジカルソート → difficulty 昇順。
 */
export async function selectDeepDiveQueue({ domainId, count }: SelectArgs): Promise<DeepStep[]> {
  const rows = await getDb()
    .select({
      id: concepts.id,
      prereqs: concepts.prereqs,
      difficultyLevels: concepts.difficultyLevels,
    })
    .from(concepts)
    .where(eq(concepts.domainId, domainId));

  if (rows.length === 0) return [];

  const order = topoSortByPrereqs(rows.map((r) => ({ id: r.id, prereqs: r.prereqs ?? [] })));
  const byId = new Map(rows.map((r) => [r.id, r] as const));

  // concept を topo 順に巡回し、各 concept の difficulty 昇順で slot を作る。
  // 全 slot を flatten した後、先頭から count 件を取る (遅い difficulty は 1 周目で出ないため
  // 後から再度同 concept を上位難度で解く構成にはしない。MVP は 1 回 1 concept × 1 diff)。
  //
  // 例: [c1:[beginner,junior], c2:[junior,mid]] → [(c1,beginner),(c1,junior),(c2,junior),(c2,mid)]
  const steps: DeepStep[] = [];
  for (const id of order) {
    const row = byId.get(id);
    if (!row) continue;
    for (const d of sortedDifficulties(row.difficultyLevels)) {
      steps.push({ conceptId: id, difficulty: d });
    }
  }
  if (steps.length === 0) return [];

  // 足りなければ循環で重複出題 (review と同じ発想)
  const result: DeepStep[] = [];
  for (let i = 0; i < count; i++) {
    result.push(steps[i % steps.length]!);
  }
  return result;
}

/** session.next から呼び出す round-robin getter */
export function pickDeepDiveStep(queue: DeepStep[], questionCount: number): DeepStep | null {
  if (queue.length === 0) return null;
  return queue[questionCount % queue.length] ?? null;
}
