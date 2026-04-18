import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { sessionTemplates } from "@/db/schema";
import { parseCustomSession } from "@/server/parser/custom-session";
import { CustomSessionSpecSchema } from "@/server/parser/schema";

import { protectedProcedure, router } from "../init";

/** テンプレ名の入力 Schema: trim して 1..80 chars に clamp。空白のみは reject。 */
const TemplateNameInput = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "テンプレ名を入力してください").max(80));

export const customRouter = router({
  /**
   * 自然言語のリクエストを CustomSessionSpec にパースする (issue #17)。
   * LLM 呼び出しは `src/server/parser/custom-session.ts` の gpt-5-mini。
   */
  parse: protectedProcedure
    .input(
      z.object({
        // 先に trim してから min/max を効かせる (末尾空白で max を誤発火させないため)。
        // min(1) で whitespace-only を reject、max(2000) は LLM コンテキスト保護。
        raw: z
          .string()
          .transform((s) => s.trim())
          .pipe(z.string().min(1, "空の入力は parse できません").max(2000)),
      }),
    )
    .mutation(async ({ input }) => {
      const { spec, promptVersion, model } = await parseCustomSession(input.raw);
      return { spec, promptVersion, model };
    }),

  /**
   * Custom Session テンプレの一覧取得 (issue #32, docs/04 §4.8)。
   * last_used_at 降順 (null は末尾)、name 昇順の順でソート。
   */
  listTemplates: protectedProcedure.query(async ({ ctx }) => {
    const rows = await getDb()
      .select()
      .from(sessionTemplates)
      .where(eq(sessionTemplates.userId, ctx.user.id))
      .orderBy(
        // lastUsedAt NULL は最後、非 NULL は新しい順
        sql`${sessionTemplates.lastUsedAt} DESC NULLS LAST`,
        sessionTemplates.name,
      );
    return { items: rows };
  }),

  /** テンプレ保存 (issue #32)。同名上書きは避け、常に insert。 */
  saveTemplate: protectedProcedure
    .input(
      z.object({
        name: TemplateNameInput,
        rawRequest: z.string().max(2000).optional(),
        spec: CustomSessionSpecSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await getDb()
        .insert(sessionTemplates)
        .values({
          userId: ctx.user.id,
          name: input.name,
          rawRequest: input.rawRequest ?? null,
          spec: input.spec,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { id: row.id };
    }),

  /**
   * テンプレ使用時に use_count+1 / last_used_at=NOW() を更新して spec を返す (issue #32)。
   * 返した spec を呼び出し側が session.start({ kind:'custom', customSpec }) にそのまま渡す。
   * userId 一致は where 句で担保 (他ユーザーの template に触れないように)。
   *
   * データ整合: SELECT → spec validate → UPDATE の 2 段階で、spec が壊れている場合に
   * use_count が加算される回帰を防ぐ (Codex Round 1 指摘)。
   * spec の健全性が確認できない限りカウンタと lastUsedAt は触らない。
   */
  useTemplate: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(sessionTemplates)
        .where(and(eq(sessionTemplates.id, input.id), eq(sessionTemplates.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "テンプレが見つかりません" });
      const spec = CustomSessionSpecSchema.safeParse(row.spec);
      if (!spec.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "保存された spec が破損しています",
        });
      }
      // spec 健全 → カウンタを atomic 加算 (行単位で Postgres がシリアライズする)
      await db
        .update(sessionTemplates)
        .set({
          useCount: sql`${sessionTemplates.useCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(and(eq(sessionTemplates.id, input.id), eq(sessionTemplates.userId, ctx.user.id)));
      return {
        id: row.id,
        name: row.name,
        rawRequest: row.rawRequest,
        spec: spec.data,
      };
    }),

  /** テンプレ削除 (userId 一致を where で担保) */
  deleteTemplate: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const rows = await getDb()
        .delete(sessionTemplates)
        .where(and(eq(sessionTemplates.id, input.id), eq(sessionTemplates.userId, ctx.user.id)))
        .returning({ id: sessionTemplates.id });
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
});
