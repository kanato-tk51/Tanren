import "server-only";

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  concepts,
  DIFFICULTY_LEVELS,
  questions,
  type Concept,
  type DifficultyLevel,
  type ThinkingStyle,
} from "@/db/schema";
import { CACHE_WINDOW_DAYS } from "@/server/generator/cache";
import { generateMcq } from "@/server/generator/mcq";

/** 1 回の cron で生成する最大問題数。LLM コスト上限のガード (docs/03 §3.3.4)。
 *  gpt-5 1 call ≒ 3-10s かかるため、Hobby の maxDuration=60s 枠内に安全に収まる件数に
 *  絞る (Codex Round 1 指摘 #2)。Pro プランで maxDuration を伸ばしたら 20 以上に上げて OK。
 */
export const PREBATCH_MAX_PER_RUN = 8;

/** combo あたり最低保ちたい cache 件数 (これ未満のところを優先的に補充) */
export const PREBATCH_TARGET_PER_COMBO = 5;

/** 未充足 combo 探索の上限 (過剰スキャンを防ぐ) */
const PREBATCH_SCAN_LIMIT = 200;

// キャッシュ窓 (日) は CACHE_WINDOW_DAYS (cache.ts) を一箇所で参照する
// (Codex Round 2 指摘: 30 の直書きをやめて単一の真実の源に一本化)。

export type Combo = {
  conceptId: string;
  difficulty: DifficultyLevel;
  /** null は thinkingStyle 指定なし */
  thinkingStyle: ThinkingStyle | null;
};

export type PrebatchResult = {
  planned: number;
  generated: number;
  failed: number;
  /** 時間切れで未実行のまま終了した件数 */
  skipped: number;
  errors: Array<{ combo: Combo; message: string }>;
};

/** 各 combo について、現在のキャッシュ件数が PREBATCH_TARGET_PER_COMBO 未満のものを
 *  優先度順 (不足量が大きい順) に返す。retired=true / 30 日より古い問題は除外する。
 *  count の取得は単一 GROUP BY クエリ (Codex Round 1 指摘 #1: N+1 回避)。
 */
export async function findDeficitCombos(params?: { now?: Date }): Promise<Combo[]> {
  const db = getDb();
  const now = params?.now ?? new Date();
  const since = new Date(now.getTime() - CACHE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const conceptRows: Pick<Concept, "id" | "difficultyLevels">[] = await db
    .select({ id: concepts.id, difficultyLevels: concepts.difficultyLevels })
    .from(concepts);
  if (conceptRows.length === 0) return [];

  // MVP: thinkingStyle は why / how / trade_off の 3 個だけ pregen。6 個全部 × concept ×
  // difficulty だと combo が指数的に膨らむため、まずはよく使う 3 個に絞る。
  const STYLES_TO_PREGEN: ThinkingStyle[] = ["why", "how", "trade_off"];
  const combos: Combo[] = [];
  for (const c of conceptRows) {
    for (const d of c.difficultyLevels) {
      if (!(DIFFICULTY_LEVELS as readonly string[]).includes(d)) continue;
      for (const s of STYLES_TO_PREGEN) {
        combos.push({ conceptId: c.id, difficulty: d, thinkingStyle: s });
        if (combos.length >= PREBATCH_SCAN_LIMIT) break;
      }
      if (combos.length >= PREBATCH_SCAN_LIMIT) break;
    }
    if (combos.length >= PREBATCH_SCAN_LIMIT) break;
  }
  if (combos.length === 0) return [];

  // 単一 GROUP BY で関連 combo の count を一括取得。concept 範囲を絞る inArray で
  // 不要な全スキャンを避ける。JS 側で key 化して参照する。
  const conceptIds = Array.from(new Set(combos.map((c) => c.conceptId)));
  const rows = await db
    .select({
      conceptId: questions.conceptId,
      difficulty: questions.difficulty,
      thinkingStyle: questions.thinkingStyle,
      cnt: sql<number>`count(*)::int`.as("cnt"),
    })
    .from(questions)
    .where(
      and(
        eq(questions.type, "mcq"),
        eq(questions.retired, false),
        gte(questions.createdAt, since),
        inArray(questions.conceptId, conceptIds),
      ),
    )
    .groupBy(questions.conceptId, questions.difficulty, questions.thinkingStyle);

  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.conceptId}|${r.difficulty}|${r.thinkingStyle ?? "null"}`;
    counts.set(key, r.cnt ?? 0);
  }

  return combos
    .map((c) => ({
      combo: c,
      deficit:
        PREBATCH_TARGET_PER_COMBO -
        (counts.get(`${c.conceptId}|${c.difficulty}|${c.thinkingStyle ?? "null"}`) ?? 0),
    }))
    .filter((x) => x.deficit > 0)
    .sort((a, b) => {
      if (b.deficit !== a.deficit) return b.deficit - a.deficit;
      if (a.combo.conceptId !== b.combo.conceptId)
        return a.combo.conceptId.localeCompare(b.combo.conceptId);
      // difficulty は DIFFICULTY_LEVELS の定義順 (beginner→principal) で並べる
      // (Codex Round 4 指摘: localeCompare だとアルファベット順で rank と乖離)。
      if (a.combo.difficulty !== b.combo.difficulty) {
        return (
          (DIFFICULTY_LEVELS as readonly string[]).indexOf(a.combo.difficulty) -
          (DIFFICULTY_LEVELS as readonly string[]).indexOf(b.combo.difficulty)
        );
      }
      // thinkingStyle tie-break で完全決定論 (Codex Round 3 指摘)
      return (a.combo.thinkingStyle ?? "").localeCompare(b.combo.thinkingStyle ?? "");
    })
    .map((x) => x.combo);
}

/** 1 回の cron で未充足 combo を最大 maxPerRun 件だけ補充。
 *  個々の失敗は errors に積むだけで次へ進む (「生成失敗時のリトライ/スキップ」)。
 *  deadlineMs を超えたら残りを skipped としてカウントし中間結果を返す
 *  (Vercel Functions の maxDuration 超過で silent kill されるのを防ぐ、Codex Round 1 指摘 #2)。
 */
export async function runPregenerateBatch(args?: {
  maxPerRun?: number;
  deadlineMs?: number;
  now?: () => number;
}): Promise<PrebatchResult> {
  const maxPerRun = Math.min(Math.max(args?.maxPerRun ?? PREBATCH_MAX_PER_RUN, 0), 50);
  const now = args?.now ?? (() => Date.now());
  const startedAt = now();
  // maxDuration=60s の手前で自主 deadline (findDeficitCombos 等の時間分 5s バッファ)
  const deadlineMs = args?.deadlineMs ?? 55_000;
  const combos = await findDeficitCombos();
  const plan = combos.slice(0, maxPerRun);
  let generated = 0;
  let failed = 0;
  let skipped = 0;
  const errors: PrebatchResult["errors"] = [];
  for (let i = 0; i < plan.length; i++) {
    if (now() - startedAt > deadlineMs) {
      skipped = plan.length - i; // 残りを skipped に計上
      break;
    }
    const combo = plan[i]!;
    try {
      await generateMcq(
        {
          conceptId: combo.conceptId,
          difficulty: combo.difficulty,
          thinkingStyle: combo.thinkingStyle,
          forceFresh: true, // cache をバイパスして新規問題を DB に追加
          // pregen は「誰にも配信されていない inventory」を積む目的。
          // serveCount=0 / lastServedAt=null で insert し、findCachedQuestion の
          // 「未使用を優先」順序で最優先で取り出せるようにする (Codex Round 2 指摘)。
          markAsServed: false,
        },
        undefined,
      );
      generated += 1;
    } catch (err) {
      failed += 1;
      errors.push({
        combo,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { planned: plan.length, generated, failed, skipped, errors };
}
