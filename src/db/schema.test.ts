import { describe, it, expectTypeOf } from "vitest";

import {
  type Attempt,
  type Concept,
  type Credential,
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
  type WebauthnChallenge,
  DIFFICULTY_LEVELS,
  DOMAIN_IDS,
  QUESTION_TYPES,
  SESSION_KINDS,
  THINKING_STYLES,
  WEBAUTHN_CHALLENGE_PURPOSES,
  concepts,
  credentials,
  sessions,
  users,
} from "./schema";

describe("db/schema", () => {
  it("users 型は id/email/displayName を持ち、createdAt は Date", () => {
    expectTypeOf<User["id"]>().toEqualTypeOf<string>();
    expectTypeOf<User["email"]>().toEqualTypeOf<string>();
    expectTypeOf<User["displayName"]>().toEqualTypeOf<string | null>();
    expectTypeOf<User["createdAt"]>().toEqualTypeOf<Date>();
  });

  it("NewUser では id/createdAt など default 付きカラムは optional", () => {
    expectTypeOf<NewUser>().toMatchTypeOf<{ email: string }>();
    // デフォルト値があるので insert 時に省略可能
    expectTypeOf<NewUser["id"]>().toEqualTypeOf<string | undefined>();
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

  it("credentials の counter は bigint", () => {
    expectTypeOf<Credential["counter"]>().toEqualTypeOf<bigint>();
    expectTypeOf<Credential["publicKey"]>().toEqualTypeOf<Uint8Array>();
  });

  it("sessionsAuth/webauthnChallenges/dailyStats/misconceptions/sessionTemplates の基本型", () => {
    expectTypeOf<SessionAuth["expiresAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<WebauthnChallenge["purpose"]>().toEqualTypeOf<
      (typeof WEBAUTHN_CHALLENGE_PURPOSES)[number]
    >();
    expectTypeOf<DailyStat["attemptsCount"]>().toEqualTypeOf<number>();
    expectTypeOf<Misconception["resolved"]>().toEqualTypeOf<boolean>();
    expectTypeOf<SessionTemplate["useCount"]>().toEqualTypeOf<number>();
  });

  it("外部キーが PgTable として認識できる (関係の土台)", () => {
    // これらが export されていれば「テーブルとして存在する」のテストになる
    expectTypeOf(users).not.toBeAny();
    expectTypeOf(concepts).not.toBeAny();
    expectTypeOf(sessions).not.toBeAny();
    expectTypeOf(credentials).not.toBeAny();
  });
});
