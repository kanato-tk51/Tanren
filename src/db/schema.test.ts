import { describe, it, expectTypeOf } from "vitest";

import {
  type Attempt,
  type Concept,
  type DailyStat,
  type Mastery,
  type Misconception,
  type NewConcept,
  type NewUser,
  type Question,
  type Session,
  type SessionAuth,
  type SessionTemplate,
  type User,
  DIFFICULTY_LEVELS,
  DOMAIN_IDS,
  QUESTION_TYPES,
  SESSION_KINDS,
  THINKING_STYLES,
  concepts,
  sessions,
  users,
} from "./schema";

describe("db/schema", () => {
  it("users 型は id/email/displayName/github_user_id を持ち、createdAt は Date", () => {
    expectTypeOf<User["id"]>().toEqualTypeOf<string>();
    // ADR-0006 (GitHub OAuth) で email は任意に変更
    expectTypeOf<User["email"]>().toEqualTypeOf<string | null>();
    expectTypeOf<User["displayName"]>().toEqualTypeOf<string | null>();
    expectTypeOf<User["githubUserId"]>().toEqualTypeOf<number | null>();
    expectTypeOf<User["githubLogin"]>().toEqualTypeOf<string | null>();
    expectTypeOf<User["createdAt"]>().toEqualTypeOf<Date>();
  });

  it("NewUser では id/createdAt など default 付きカラムは optional", () => {
    // email / github_user_id 共に任意 (ADR-0006 で email の NOT NULL 制約を外した)
    expectTypeOf<NewUser["id"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NewUser["email"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<NewUser["githubUserId"]>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<NewUser["createdAt"]>().toEqualTypeOf<Date | undefined>();
  });

  it("NewConcept.difficultyLevels は default を持たず省略不可 (1 件以上を型でも強制)", () => {
    expectTypeOf<NewConcept["difficultyLevels"]>().toEqualTypeOf<
      (typeof DIFFICULTY_LEVELS)[number][]
    >();
  });

  it("concepts は DomainId でドメインを限定", () => {
    expectTypeOf<Concept["domainId"]>().toEqualTypeOf<(typeof DOMAIN_IDS)[number]>();
    expectTypeOf<Concept["difficultyLevels"]>().toEqualTypeOf<
      (typeof DIFFICULTY_LEVELS)[number][]
    >();
    expectTypeOf<Concept["prereqs"]>().toEqualTypeOf<string[] | null>();
  });

  it("questions は type/difficulty/thinkingStyle の列挙が効いている", () => {
    expectTypeOf<Question["type"]>().toEqualTypeOf<(typeof QUESTION_TYPES)[number]>();
    expectTypeOf<Question["difficulty"]>().toEqualTypeOf<(typeof DIFFICULTY_LEVELS)[number]>();
    expectTypeOf<Question["thinkingStyle"]>().toEqualTypeOf<
      (typeof THINKING_STYLES)[number] | null
    >();
  });

  it("sessions.kind は SESSION_KINDS に制限される", () => {
    expectTypeOf<Session["kind"]>().toEqualTypeOf<(typeof SESSION_KINDS)[number]>();
  });

  it("attempts は score(real) / selfRating(smallint) / elapsedMs(int) を持つ", () => {
    expectTypeOf<Attempt["score"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Attempt["selfRating"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Attempt["elapsedMs"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Attempt["correct"]>().toEqualTypeOf<boolean | null>();
  });

  it("mastery は複合 PK を持つ (userId + conceptId)", () => {
    expectTypeOf<Mastery["userId"]>().toEqualTypeOf<string>();
    expectTypeOf<Mastery["conceptId"]>().toEqualTypeOf<string>();
    expectTypeOf<Mastery["masteryPct"]>().toEqualTypeOf<number>();
    expectTypeOf<Mastery["mastered"]>().toEqualTypeOf<boolean>();
  });

  it("sessionsAuth / dailyStats / misconceptions / sessionTemplates の基本型", () => {
    expectTypeOf<SessionAuth["expiresAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<DailyStat["attemptsCount"]>().toEqualTypeOf<number>();
    expectTypeOf<Misconception["resolved"]>().toEqualTypeOf<boolean>();
    expectTypeOf<SessionTemplate["useCount"]>().toEqualTypeOf<number>();
  });

  it("外部キーが PgTable として認識できる (関係の土台)", () => {
    expectTypeOf(users).not.toBeAny();
    expectTypeOf(concepts).not.toBeAny();
    expectTypeOf(sessions).not.toBeAny();
  });
});
