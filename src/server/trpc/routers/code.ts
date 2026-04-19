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

function checkRateLimit(userId: string, now: number = Date.now()): void {
  const list = rateMap.get(userId) ?? [];
  const fresh = list.filter((t) => now - t < RATE_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_PER_MINUTE) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `コード実行の rate limit 超過 (1分間あたり ${RATE_LIMIT_PER_MINUTE} 本まで)`,
    });
  }
  fresh.push(now);
  rateMap.set(userId, fresh);
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
      checkRateLimit(ctx.user.id);
      try {
        const result = await executeCode({
          language: input.language as keyof typeof JUDGE0_LANGUAGES,
          source: input.source,
          stdin: input.stdin,
        });
        return result;
      } catch (err) {
        if (err instanceof Judge0DisabledError) {
          throw new TRPCError({
            code: "NOT_IMPLEMENTED",
            message: err.message,
          });
        }
        if (err instanceof Judge0RequestError) {
          throw new TRPCError({
            code: err.statusCode === 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),
});
