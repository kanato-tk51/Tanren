import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import {
  attempts,
  concepts,
  DIFFICULTY_LEVELS,
  DOMAIN_IDS,
  SESSION_KINDS,
  sessions,
  THINKING_STYLES,
  type DifficultyLevel,
  type DomainId,
} from "@/db/schema";
import type { CopyForLlmQuestionMeta } from "@/lib/share/copy-for-llm";
import { generateMcq } from "@/server/generator/mcq";
import { gradeAttempt } from "@/server/grader";
import { CustomSessionSpecSchema, type CustomSessionSpec } from "@/server/parser/schema";
import { selectDailyCandidates } from "@/server/scheduler/daily";
import {
  DEEP_DIVE_DEFAULT_COUNT,
  DEEP_DIVE_MAX_COUNT,
  DEEP_DIVE_MIN_COUNT,
  pickDeepDiveStep,
  selectDeepDiveQueue,
  type DeepStep,
} from "@/server/scheduler/deep-dive";
import {
  DIAGNOSTIC_DEFAULT_COUNT,
  DIAGNOSTIC_MAX_COUNT,
  DIAGNOSTIC_MIN_COUNT,
  pickDiagnosticConcept,
  selectDiagnosticConcepts,
} from "@/server/scheduler/diagnostic";
import { STREAK_FOR_PROMOTION, computePromotion } from "@/server/scheduler/promotion";
import {
  REVIEW_DEFAULT_COUNT,
  REVIEW_DEFAULT_DAYS,
  REVIEW_MAX_COUNT,
  pickReviewConcept,
  selectReviewCandidates,
} from "@/server/scheduler/review";

import { protectedProcedure, router } from "../init";

const SessionKindEnum = z.enum(SESSION_KINDS);
const DifficultyEnum = z.enum(DIFFICULTY_LEVELS);
const ThinkingStyleEnum = z.enum(THINKING_STYLES);

const DEFAULT_DRILL_LENGTH = 5;

type SessionSpec = {
  targetCount?: number;
  /** 出題中の question.id。submit 時に一致チェックして「別問題への水増し submit」を防ぐ */
  pendingQuestionId?: string | null;
  /** Custom Session 指定 (kind: 'custom' のときだけ埋まる。issue #18) */
  customSpec?: CustomSessionSpec;
  /** Mistake Review (issue #23) の開始時に決まった concept のキュー。kind='review' のみ埋まる */
  reviewConceptIds?: string[];
  /** Diagnostic (issue #26) の開始時に決まった concept のキュー。kind='diagnostic' のみ埋まる */
  diagnosticConceptIds?: string[];
  /** Diagnostic で使う固定難易度 (= user.selfLevel)。kind='diagnostic' のみ埋まる */
  diagnosticDifficulty?: DifficultyLevel;
  /** Deep Dive (issue #28) の開始時に決まった (conceptId, difficulty) のキュー。kind='deep' のみ埋まる */
  deepQueue?: DeepStep[];
  /** Deep Dive のドメイン (spec 整合性チェック用)。kind='deep' のみ埋まる */
  deepDomainId?: DomainId;
};

async function loadSession(sessionId: string, userId: string) {
  const rows = await getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "session not found" });
  if (row.finishedAt) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "session already finished" });
  }
  return row;
}

async function pickConceptForDrill(userId: string, requiredDifficulty?: DifficultyLevel) {
  // Daily Drill の優先度アルゴリズム (docs/06 §6.4) に委譲。
  // due / blind_spot のどちらも空だと候補が 0 件になるので PRECONDITION_FAILED。
  // Custom Session の difficulty 指定時は selectDailyCandidates の difficultyFilter を使って
  // concept 総数が増えても上位に埋もれないよう scoring/slice の前に filter する。
  const candidates = await selectDailyCandidates({
    userId,
    count: 1,
    difficultyFilter: requiredDifficulty,
  });
  if (candidates[0]) return candidates[0].concept;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: requiredDifficulty
      ? `difficulty=${requiredDifficulty} を許容する concept が候補に無い。concepts を明示指定してください`
      : "no drill candidate: seed にある concept が 0 件か、全 concept の prereqs が未充足。seed を確認してください",
  });
}

async function loadConcept(conceptId: string) {
  const rows = await getDb().select().from(concepts).where(eq(concepts.id, conceptId)).limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `unknown concept: ${conceptId}` });
  return row;
}

/** サーバー側でシャッフルした options (answer + distractors) を返す。seed は question.id */
function shuffleWithSeed<T>(array: T[], seed: string): T[] {
  const copy = array.slice();
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = copy.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [copy[i]!, copy[j]!] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export const sessionRouter = router({
  start: protectedProcedure
    .input(
      z.object({
        kind: SessionKindEnum.default("daily"),
        targetCount: z.number().int().min(1).max(20).optional(),
        /** Custom Session 指定時のみ。パース結果 (CustomSessionSpec) を Zod で再検証 */
        customSpec: CustomSessionSpecSchema.optional(),
        /** Deep Dive (issue #28) の対象ドメイン。kind='deep' のとき必須 */
        domainId: z.enum(DOMAIN_IDS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.kind === "custom" && !input.customSpec) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "kind='custom' には customSpec が必要です",
        });
      }
      if (input.kind !== "custom" && input.customSpec) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "customSpec は kind='custom' のときだけ指定できます",
        });
      }

      // 絶対難易度 6 段階 (beginner/junior/mid/senior/staff/principal) を全て受け入れる。
      // Issue #18 AC の「beginner/junior/mid/senior のみ」記述は保守的な初期値で、
      // parser / prompt / docs (§4.10.1) / _constants.ts は 6 段階で統一されているため
      // session.start もそれに合わせる (Round 10 指摘)。
      // DifficultyAbsoluteSchema.level が 6 段階 enum なので実装追加の validation は不要。
      // MVP は mcq 生成のみ。UI 注記と一致させるため、正確に ['mcq'] (単一要素) だけ許可する。
      // ['mcq', 'written'] などの混在、['mcq', 'mcq'] のような重複も reject。
      if (input.customSpec?.questionTypes && input.customSpec.questionTypes.length > 0) {
        const isExactMcqSingleton =
          input.customSpec.questionTypes.length === 1 &&
          input.customSpec.questionTypes[0] === "mcq";
        if (!isExactMcqSingleton) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Custom Session MVP は questionTypes=['mcq'] のみ許可です",
          });
        }
      }
      // MVP は thinkingStyles を 1 件までしか出題に反映できない (next は [0] のみ参照)。
      // 2 件以上指定は「指定が黙示に捨てられる」虚偽表示になるため reject。
      if (input.customSpec?.thinkingStyles && input.customSpec.thinkingStyles.length > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Custom Session MVP は thinkingStyles を 1 件のみ指定できます",
        });
      }
      // MVP は concepts も 1 件まで (next は [0] のみ参照、2 件目以降は使われない)
      if (input.customSpec?.concepts && input.customSpec.concepts.length > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Custom Session MVP は concepts を 1 件のみ指定できます",
        });
      }
      // concepts[0] が指定されていれば常に concept の存在を確認する (Round 4 指摘 #1)。
      // 不正/陳腐化した conceptId のリンクで空 session row が残るのを防ぐため、
      // difficulty 未指定でも事前 loadConcept を通す。difficulty も指定されていれば
      // concept.difficultyLevels との整合も同時にチェック。
      if (input.customSpec?.concepts?.[0]) {
        const concept = await loadConcept(input.customSpec.concepts[0]);
        if (input.customSpec.difficulty) {
          const level = input.customSpec.difficulty.level;
          if (!concept.difficultyLevels.includes(level)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `concept "${concept.id}" は difficulty=${level} をサポートしていません (対応: ${concept.difficultyLevels.join(", ")})`,
            });
          }
        }
      }
      // constraints は MVP で生成プロンプトに反映されないため、該当フィールドがあれば reject
      // (プレビューで「指定した」と見えて実行時に無視されるのは虚偽表示に近い挙動なので)。
      if (input.customSpec?.constraints) {
        const c = input.customSpec.constraints;
        if (
          c.language ||
          c.codeLanguage ||
          c.timeLimitSec ||
          c.mustInclude?.length ||
          c.avoid?.length
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Custom Session MVP は constraints (language/codeLanguage/timeLimitSec/mustInclude/avoid) 未対応です",
          });
        }
      }
      // domains / subdomains / excludeConcepts も現状プロンプトに反映されないため、
      // 同じ理由 (虚偽表示回避) で reject する。MVP は concepts[0] で concept を直接指定する運用。
      if (
        input.customSpec?.domains?.length ||
        input.customSpec?.subdomains?.length ||
        input.customSpec?.excludeConcepts?.length
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Custom Session MVP は domains / subdomains / excludeConcepts 未対応です (concepts[0] で直接指定してください)",
        });
      }

      const db = getDb();

      // Mistake Review (issue #23): 直近 14 日の誤答 concept を先に選定してキュー化。
      // 該当 concept が 0 件なら PRECONDITION_FAILED で返し、セッションは作らない。
      // targetCount は 10..15 に強制 clamp (受け入れ基準「10-15 問」)。candidates が
      // 10 件未満でも session.next のラウンドロビンで同 concept を複数回出題して埋める
      // (同じ concept の別タイプ/スタイルで出題してもよいという受け入れ基準に合致)。
      let reviewConceptIds: string[] | undefined;
      let reviewTargetCount: number | undefined;
      if (input.kind === "review") {
        const clamped = Math.min(
          Math.max(input.targetCount ?? REVIEW_DEFAULT_COUNT, REVIEW_DEFAULT_COUNT),
          REVIEW_MAX_COUNT,
        );
        const candidates = await selectReviewCandidates({
          userId: ctx.user.id,
          count: REVIEW_MAX_COUNT,
          days: REVIEW_DEFAULT_DAYS,
        });
        if (candidates.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "直近 14 日の誤答がありません。まずは Daily Drill で解いてください。",
          });
        }
        reviewConceptIds = candidates.map((c) => c.concept.id);
        reviewTargetCount = clamped;
      }

      // Deep Dive (issue #28): domain 内 concept を prereqs トポロジカルソート + difficulty 昇順で
      // 並べて targetCount 件の (conceptId, difficulty) キューを作る。domain 未指定なら BAD_REQUEST、
      // 候補 0 件は PRECONDITION_FAILED。domainId は kind='deep' 以外で指定されたら reject (混入防止)。
      let deepQueue: DeepStep[] | undefined;
      let deepTargetCount: number | undefined;
      let deepDomainId: DomainId | undefined;
      if (input.kind === "deep") {
        if (!input.domainId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "kind='deep' には domainId が必要です",
          });
        }
        const clamped = Math.min(
          Math.max(input.targetCount ?? DEEP_DIVE_DEFAULT_COUNT, DEEP_DIVE_MIN_COUNT),
          DEEP_DIVE_MAX_COUNT,
        );
        const queue = await selectDeepDiveQueue({ domainId: input.domainId, count: clamped });
        if (queue.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `domain="${input.domainId}" に concept がありません`,
          });
        }
        deepQueue = queue;
        deepTargetCount = queue.length;
        deepDomainId = input.domainId;
      } else if (input.domainId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "domainId は kind='deep' のときだけ指定できます",
        });
      }

      // Diagnostic (issue #26): user.interestDomains × user.selfLevel から concept キューを作る。
      // user 側の prefs が空なら PRECONDITION_FAILED で onboarding.savePreferences を促す。
      // targetCount は DIAGNOSTIC_MIN..MAX に強制 clamp。candidates 0 件なら PRECONDITION_FAILED。
      let diagnosticConceptIds: string[] | undefined;
      let diagnosticTargetCount: number | undefined;
      let diagnosticDifficulty: DifficultyLevel | undefined;
      if (input.kind === "diagnostic") {
        const interestDomains = ctx.user.interestDomains ?? [];
        const selfLevel = ctx.user.selfLevel;
        if (interestDomains.length === 0 || !selfLevel) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "興味分野と自己申告レベルが未設定です。先に onboarding.savePreferences を呼んでください",
          });
        }
        const clamped = Math.min(
          Math.max(input.targetCount ?? DIAGNOSTIC_DEFAULT_COUNT, DIAGNOSTIC_MIN_COUNT),
          DIAGNOSTIC_MAX_COUNT,
        );
        const queue = await selectDiagnosticConcepts({
          interestDomains,
          selfLevel,
          count: clamped,
        });
        if (queue.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "選んだ興味分野・レベルに合致する concept がありません。seed を確認してください",
          });
        }
        diagnosticConceptIds = queue;
        diagnosticTargetCount = queue.length; // 実際に出題する数 (queue 不足時は count より少ない)
        diagnosticDifficulty = selfLevel;
      }

      // 問題数の決定順位:
      //   1. Custom Session の questionCount
      //   2. Review の場合は reviewTargetCount (10..15 clamp)
      //   3. Diagnostic の場合は diagnosticTargetCount (= queue.length)
      //   4. Deep Dive の場合は deepTargetCount (= queue.length)
      //   5. input.targetCount
      //   6. 既定 5
      const targetCount =
        input.customSpec?.questionCount ??
        reviewTargetCount ??
        diagnosticTargetCount ??
        deepTargetCount ??
        input.targetCount ??
        DEFAULT_DRILL_LENGTH;
      const spec: SessionSpec = {
        targetCount,
        pendingQuestionId: null,
        ...(input.customSpec ? { customSpec: input.customSpec } : {}),
        ...(reviewConceptIds ? { reviewConceptIds } : {}),
        ...(diagnosticConceptIds ? { diagnosticConceptIds } : {}),
        ...(diagnosticDifficulty ? { diagnosticDifficulty } : {}),
        ...(deepQueue ? { deepQueue } : {}),
        ...(deepDomainId ? { deepDomainId } : {}),
      };
      const [session] = await db
        .insert(sessions)
        .values({ userId: ctx.user.id, kind: input.kind, spec })
        .returning();
      if (!session) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { sessionId: session.id, targetCount };
    }),

  next: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        conceptId: z.string().optional(),
        difficulty: DifficultyEnum.default("junior"),
        thinkingStyle: ThinkingStyleEnum.nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await loadSession(input.sessionId, ctx.user.id);
      const spec = (session.spec ?? {}) as SessionSpec;
      const target = spec.targetCount ?? DEFAULT_DRILL_LENGTH;
      if (session.questionCount >= target) {
        return { done: true as const };
      }
      // pendingQuestionId がある = 直前の問題を未回答
      if (spec.pendingQuestionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "submit the current pending question before fetching the next one",
        });
      }

      // 原子予約: pendingQuestionId が null のときだけ "__reserved__" にスワップ。
      // 並行 next で losing race になった側は 0 行更新となり早期 return で OpenAI 呼び出しを避ける
      const RESERVED = "__reserving__";
      const reserved = await getDb()
        .update(sessions)
        .set({ spec: { ...spec, pendingQuestionId: RESERVED } })
        .where(
          and(
            eq(sessions.id, session.id),
            sql`(${sessions.spec}->>'pendingQuestionId') IS NULL`,
            isNull(sessions.finishedAt),
          ),
        )
        .returning({ id: sessions.id });
      if (reserved.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "another request already reserved the next question; retry",
        });
      }

      // 予約後に問題生成が失敗したら pendingQuestionId を null に戻してセッションを復帰させる。
      let question: Awaited<ReturnType<typeof generateMcq>>["question"];
      let questionMeta: CopyForLlmQuestionMeta | null = null;
      try {
        // Custom Session は spec.customSpec (absolute difficulty + thinking_style 等) を優先する。
        // MVP での concept 選定: customSpec.concepts[0] → daily pick の 2 段階。
        // domains / subdomains / excludeConcepts は session.start で reject 済みのためここには来ない。
        //
        // 認可境界: kind='custom' のときは input.conceptId で保存済み spec を迂回できないよう
        // customSpec.concepts[0] を強制する (セッション開始時に確定した spec が唯一の真実の源)。
        //
        // Mistake Review (kind='review') は start 時に決定した reviewConceptIds を
        // questionCount の順に 1 対 1 で割り当てる (ラウンドロビン、issue #23)。
        const customSpec = spec.customSpec;
        const customConceptId = customSpec?.concepts?.[0];
        const reviewConceptId =
          session.kind === "review"
            ? pickReviewConcept(spec.reviewConceptIds, session.questionCount)
            : null;
        const diagnosticConceptId =
          session.kind === "diagnostic"
            ? pickDiagnosticConcept(spec.diagnosticConceptIds ?? [], session.questionCount)
            : null;
        const deepStep =
          session.kind === "deep"
            ? pickDeepDiveStep(spec.deepQueue ?? [], session.questionCount)
            : null;
        const effectiveConceptId = reviewConceptId
          ? reviewConceptId
          : diagnosticConceptId
            ? diagnosticConceptId
            : deepStep
              ? deepStep.conceptId
              : customSpec
                ? (customConceptId ?? null)
                : (input.conceptId ?? null);
        // Custom で concept 未指定 + difficulty 指定時は、pickConceptForDrill で
        // その難易度を許容する concept のみを候補にする (start 時の整合は
        // concept 未指定ケースで検証できないので、ここでも補完的に filter)。
        const conceptRow = effectiveConceptId
          ? await loadConcept(effectiveConceptId)
          : await pickConceptForDrill(ctx.user.id, customSpec?.difficulty?.level);

        // 直近 STREAK_FOR_PROMOTION 件の同 concept の attempts を見て、3 連続正解なら次出題を 1 段昇格
        const recent = await getDb()
          .select({ correct: attempts.correct })
          .from(attempts)
          .where(and(eq(attempts.userId, ctx.user.id), eq(attempts.conceptId, conceptRow.id)))
          .orderBy(desc(attempts.createdAt))
          .limit(STREAK_FOR_PROMOTION);
        // 難易度の決定:
        //   1. 「昇格しない」モード = Custom / Diagnostic / Deep Dive
        //      - Custom: customSpec.difficulty を優先、無ければ concept.difficultyLevels[0] → input.difficulty fallback
        //      - Diagnostic: spec.diagnosticDifficulty (= user.selfLevel) を優先、無ければ concept fallback
        //      - Deep Dive: deepStep.difficulty (予め topo+difficulty 昇順に決定) を優先、無ければ concept fallback
        //   2. 通常 (Daily / Review): input.difficulty を起点に 3 連続正解で 1 段昇格
        // どちらのモードでも、concept が選んだ難易度を含まなければ concept.difficultyLevels[0] に
        // 改めて fallback する (input.difficulty 既定 'junior' が concept 非対応で generateMcq が落ちる回避)。
        const skipPromotion =
          customSpec != null || session.kind === "diagnostic" || session.kind === "deep";
        const preferredDifficulty: DifficultyLevel = customSpec
          ? (customSpec.difficulty?.level ?? conceptRow.difficultyLevels[0] ?? input.difficulty)
          : session.kind === "diagnostic"
            ? (spec.diagnosticDifficulty ?? conceptRow.difficultyLevels[0] ?? input.difficulty)
            : session.kind === "deep"
              ? (deepStep?.difficulty ?? conceptRow.difficultyLevels[0] ?? input.difficulty)
              : input.difficulty;
        const requestedDifficulty: DifficultyLevel = conceptRow.difficultyLevels.includes(
          preferredDifficulty,
        )
          ? preferredDifficulty
          : (conceptRow.difficultyLevels[0] ?? input.difficulty);
        const promoted = skipPromotion
          ? null
          : computePromotion({
              concept: { difficultyLevels: conceptRow.difficultyLevels },
              currentDifficulty: input.difficulty,
              recentCorrect: recent.map((r) => r.correct === true),
            });
        const effectiveDifficulty: DifficultyLevel = promoted ?? requestedDifficulty;

        // thinking_style も custom spec があれば先頭を使う。複数指定はラウンドロビン未実装 (MVP)。
        const effectiveThinkingStyle = customSpec?.thinkingStyles?.[0] ?? input.thinkingStyle;

        const generated = await generateMcq({
          conceptId: conceptRow.id,
          difficulty: effectiveDifficulty,
          thinkingStyle: effectiveThinkingStyle,
          // 生成プロンプトに「この concept で繰り返し誤解」を注入する (issue #19)。
          userId: ctx.user.id,
        });
        question = generated.question;
        questionMeta = {
          domain: conceptRow.domainId,
          subdomain: conceptRow.subdomainId,
          conceptId: conceptRow.id,
          conceptName: conceptRow.name,
          thinkingStyle: effectiveThinkingStyle,
          difficulty: effectiveDifficulty,
        };
      } catch (err) {
        await getDb()
          .update(sessions)
          .set({ spec: { ...spec, pendingQuestionId: null } })
          .where(eq(sessions.id, session.id))
          .catch(() => {
            // ロールバック失敗は握りつぶす (本体エラーを優先して throw する)
          });
        throw err;
      }

      // 出題中の questionId を session に記録 (submit 時の整合性チェック用)
      await getDb()
        .update(sessions)
        .set({ spec: { ...spec, pendingQuestionId: question.id } })
        .where(eq(sessions.id, session.id));

      // answer はクライアントに返さず options だけ返す (正答漏洩防止)。
      // mcq は answer + distractors を shuffle、それ以外 (cloze / code_read / short / written) は
      // 選択肢を持たないため空配列で返す (UI 側で type を見て textarea / code display に分岐)。
      const qType = (question as { type?: string }).type ?? "mcq";
      const options =
        qType === "mcq"
          ? shuffleWithSeed(
              [question.answer, ...((question.distractors ?? []) as string[])],
              question.id,
            )
          : [];
      return {
        done: false as const,
        question: {
          id: question.id,
          prompt: question.prompt,
          type: qType,
          options,
          hint: question.hint,
          tags: (question.tags ?? []) as string[],
          meta: questionMeta,
        },
      };
    }),

  submit: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        questionId: z.string().min(1),
        userAnswer: z.string(),
        elapsedMs: z.number().int().min(0).optional(),
        reasonGiven: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await loadSession(input.sessionId, ctx.user.id);
      const spec = (session.spec ?? {}) as SessionSpec;
      if (spec.pendingQuestionId !== input.questionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "questionId does not match the pending question for this session",
        });
      }

      // Custom Session の updateMastery=false は FSRS/mastery 更新をスキップ (docs/04 §4.9.2)
      const submitUpdateMastery = spec.customSpec?.updateMastery ?? true;
      const result = await gradeAttempt({
        userId: ctx.user.id,
        sessionId: session.id,
        questionId: input.questionId,
        userAnswer: input.userAnswer,
        elapsedMs: input.elapsedMs,
        reasonGiven: input.reasonGiven,
        updateMastery: submitUpdateMastery,
      });

      // 二重送信対策: sql で原子インクリメント + pendingQuestionId 一致 + finishedAt is null の
      // 条件下でのみ 1 行更新。並行 submit で losing race になった側は 0 行更新で素通り
      // (既に 1 度カウントされているので attempts テーブルの一意性で十分)
      const updated = await getDb()
        .update(sessions)
        .set({
          questionCount: sql`${sessions.questionCount} + 1`,
          correctCount: sql`${sessions.correctCount} + ${result.correct ? 1 : 0}`,
          spec: { ...spec, pendingQuestionId: null },
        })
        .where(
          and(
            eq(sessions.id, session.id),
            sql`(${sessions.spec}->>'pendingQuestionId') = ${input.questionId}`,
            isNull(sessions.finishedAt),
          ),
        )
        .returning({ id: sessions.id });
      if (updated.length === 0) {
        // 競合 (同じ問題への並行 submit) は先着が既に処理済み。カウンタは進まずに終了
      }

      return {
        attemptId: result.attempt.id,
        correct: result.correct,
        score: result.score,
        feedback: result.feedback,
        questionType: result.questionType,
        correctAnswer: result.correctAnswer,
        rubricChecks: result.rubricChecks,
      };
    }),

  finish: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const session = await loadSession(input.sessionId, ctx.user.id);
      const spec = (session.spec ?? {}) as SessionSpec;
      const target = spec.targetCount ?? DEFAULT_DRILL_LENGTH;
      // targetCount に達していない状態での finish は拒否 (受け入れ基準の保証)
      if (session.questionCount < target) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `session cannot finish before ${target} questions (current: ${session.questionCount})`,
        });
      }

      const [updated] = await getDb()
        .update(sessions)
        .set({ finishedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const allAttempts = await getDb()
        .select({ correct: attempts.correct })
        .from(attempts)
        .where(eq(attempts.sessionId, session.id));
      const correct = allAttempts.filter((a) => a.correct === true).length;
      return {
        sessionId: updated.id,
        questionCount: allAttempts.length,
        correctCount: correct,
        accuracy: allAttempts.length > 0 ? correct / allAttempts.length : 0,
      };
    }),
});
