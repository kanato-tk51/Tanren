import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  executeCode,
  JUDGE0_MAX_SOURCE_BYTES,
  Judge0DisabledError,
  Judge0RequestError,
} from "@/lib/judge0/client";
import { JUDGE0_LANGUAGES } from "@/lib/judge0/languages";

import { protectedProcedure, router } from "../init";

/** ユーザーあたり 1 分間に実行できる最大本数。MVP は in-memory Map で実装
 *  (Vercel Functions のインスタンス寿命は短いので厳密ではないが、同一 inst 内の暴走は防げる)。
 *  本番環境で複数インスタンスに跨るレート制限が必要になったら Upstash Redis 等に移行する。
 */
const RATE_LIMIT_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60 * 1000;

/** Map<userId, timestamps[]>。RATE_WINDOW_MS より古い timestamp は gc される。 */
const rateMap = new Map<string, number[]>();

/** 上限超過なら TOO_MANY_REQUESTS を throw。実際に Judge0 を叩くかは呼び出し側 (成功時に recordRateLimitHit)。
 *  Codex Round 1 指摘 #2: Judge0DisabledError や 事前 reject でクォータを消費しないよう、
 *  ここではチェックだけ行いカウント消費は recordRateLimitHit に分離する。
 */
function assertRateLimit(userId: string, now: number = Date.now()): void {
  const list = rateMap.get(userId) ?? [];
  const fresh = list.filter((t) => now - t < RATE_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_PER_MINUTE) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `コード実行の rate limit 超過 (1分間あたり ${RATE_LIMIT_PER_MINUTE} 本まで)`,
    });
  }
  rateMap.set(userId, fresh);
}

/** Judge0 に実際にコストがかかった呼び出し (= 成功 or 429 等 Judge0 側応答) のみカウントする */
function recordRateLimitHit(userId: string, now: number = Date.now()): void {
  const list = rateMap.get(userId) ?? [];
  list.push(now);
  rateMap.set(userId, list);
}

/** テスト用の reset helper (router 側では export しない) */
export function __resetRateLimitForTest(): void {
  rateMap.clear();
}

export const codeRouter = router({
  /**
   * Judge0 でコードを実行する (issue #34)。
   * 入力制限: source / stdin は各 10KB まで、language は MVP 対応の 3 種のみ。
   * 保護層: per-user in-memory rate limit (30 req/min)。Judge0 env 未設定時は NOT_IMPLEMENTED。
   */
  execute: protectedProcedure
    .input(
      z.object({
        language: z.enum(Object.keys(JUDGE0_LANGUAGES) as [string, ...string[]]),
        source: z.string().min(1).max(JUDGE0_MAX_SOURCE_BYTES),
        stdin: z.string().max(JUDGE0_MAX_SOURCE_BYTES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRateLimit(ctx.user.id);
      try {
        const result = await executeCode({
          language: input.language as keyof typeof JUDGE0_LANGUAGES,
          source: input.source,
          stdin: input.stdin,
        });
        // 成功時のみクォータを消費 (Codex Round 1 指摘 #2)
        recordRateLimitHit(ctx.user.id);
        return result;
      } catch (err) {
        if (err instanceof Judge0DisabledError) {
          // env 未設定: コストかかっていないのでカウントしない
          throw new TRPCError({
            code: "NOT_IMPLEMENTED",
            message: err.message,
          });
        }
        if (err instanceof Judge0RequestError) {
          // Judge0 に到達した失敗 (429 / コンパイルエラー等) はコスト発生したと見なしカウント。
          // 事前 validation 失敗 (size limit 等) は Judge0 未到達なのでカウントしない方針だが、
          // 本実装では統一的に「Judge0RequestError = カウントする」とする
          // (事前 validation エラーは呼び出し側で zod バリデーション済みの想定のため実質発火しない)。
          recordRateLimitHit(ctx.user.id);
          throw new TRPCError({
            code: err.statusCode === 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),
});
