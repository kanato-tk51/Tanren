import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  concepts,
  DIFFICULTY_LEVELS,
  questions,
  type Concept,
  type DifficultyLevel,
  type ThinkingStyle,
} from "@/db/schema";
import { generateMcq } from "@/server/generator/mcq";

/** 1 回の cron で生成する最大問題数。LLM コスト上限のガード (docs/03 §3.3.4)。
 *  Vercel Hobby の日次 cron だと 30 回/月 × 20 件 = 600 件/月が上限。
 */
export const PREBATCH_MAX_PER_RUN = 20;

/** combo あたり最低保ちたい cache 件数 (これ未満のところを優先的に補充) */
export const PREBATCH_TARGET_PER_COMBO = 5;

/** 未充足 combo 探索の上限 (過剰スキャンを防ぐ) */
const PREBATCH_SCAN_LIMIT = 200;

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
  errors: Array<{ combo: Combo; message: string }>;
};

/** 各 combo について、現在のキャッシュ件数が PREBATCH_TARGET_PER_COMBO 未満のものを
 *  優先度順 (不足量が大きい順) に返す。retired/失敗した問題は含めない。
 */
export async function findDeficitCombos(params?: { now?: Date }): Promise<Combo[]> {
  void params;
  const db = getDb();
  // concepts × difficulty (concept.difficultyLevels から展開) × thinkingStyle を
  // JS 側で作って、各 combo の cache count を SQL で取る方が concept を先に絞れて楽。
  const conceptRows: Pick<Concept, "id" | "difficultyLevels">[] = await db
    .select({ id: concepts.id, difficultyLevels: concepts.difficultyLevels })
    .from(concepts);

  // MVP: thinkingStyle は why / how / trade_off の 3 個だけ pregen (代表的なもの)。
  // 6 個全部 × concept 数 × difficulty 数 だと combo が指数的に膨らむため、
  // まずはよく使う 3 個に絞る。必要になれば env で広げられる。
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

  // 各 combo の cache count を一括で取る (N+1 を避けるため UNION ALL で)。
  // MVP で combo 数が 200 以下なら 1 クエリに収まる。
  if (combos.length === 0) return [];
  const counts = new Map<string, number>();
  for (const combo of combos) {
    const rows = await db
      .select({ cnt: sql<number>`count(*)::int`.as("cnt") })
      .from(questions)
      .where(
        and(
          eq(questions.conceptId, combo.conceptId),
          eq(questions.difficulty, combo.difficulty),
          eq(questions.type, "mcq"),
          combo.thinkingStyle
            ? eq(questions.thinkingStyle, combo.thinkingStyle)
            : sql`${questions.thinkingStyle} IS NULL`,
          eq(questions.retired, false),
        ),
      );
    const cnt = rows[0]?.cnt ?? 0;
    const key = `${combo.conceptId}|${combo.difficulty}|${combo.thinkingStyle ?? "null"}`;
    counts.set(key, cnt);
  }

  // 不足量 (TARGET - cnt) の降順で並べる。同値は decidable な順序で安定化
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
      return a.combo.difficulty.localeCompare(b.combo.difficulty);
    })
    .map((x) => x.combo);
}

/** 1 回の cron で未充足 combo を最大 PREBATCH_MAX_PER_RUN 件だけ補充。
 *  個々の失敗は errors に積むだけで次へ進む (「生成失敗時のリトライ/スキップ」)。
 */
export async function runPregenerateBatch(args?: { maxPerRun?: number }): Promise<PrebatchResult> {
  const maxPerRun = Math.min(Math.max(args?.maxPerRun ?? PREBATCH_MAX_PER_RUN, 0), 50);
  const combos = await findDeficitCombos();
  const plan = combos.slice(0, maxPerRun);
  let generated = 0;
  let failed = 0;
  const errors: PrebatchResult["errors"] = [];
  for (const combo of plan) {
    try {
      await generateMcq(
        {
          conceptId: combo.conceptId,
          difficulty: combo.difficulty,
          thinkingStyle: combo.thinkingStyle,
          forceFresh: true, // cache をバイパスして新規問題を DB に追加
          // userId を渡さないので misconception 注入もされず、共有 cache 向けの純粋な問題になる
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
  return { planned: plan.length, generated, failed, errors };
}
