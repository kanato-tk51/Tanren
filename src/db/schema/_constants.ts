/**
 * 13 ドメインのマスタは docs/02-learning-system.md §2.1.1 が真実の源。
 * ここでは TypeScript 側で型を締めるための列挙だけを定義する。
 *
 * MVP は Tier 1 の 6 ドメイン (programming / dsa / network / db / tools / frontend) から
 * 開始し、Tier 2 (os / security / design / devops / ai_ml)、Tier 3 (distributed / low_level)
 * へ順次拡張する。
 */
export const DOMAIN_IDS = [
  "programming",
  "dsa",
  "os",
  "network",
  "db",
  "security",
  "distributed",
  "design",
  "devops",
  "tools",
  "low_level",
  "ai_ml",
  "frontend",
] as const;
export type DomainId = (typeof DOMAIN_IDS)[number];

/** ADR-0001 で統一された 6 段階 */
export const DIFFICULTY_LEVELS = [
  "beginner",
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const SESSION_KINDS = ["daily", "deep", "custom", "review", "diagnostic"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

/** Onboarding (issue #26) でユーザーが選べる興味分野 = Tier 1 6 ドメイン。
 *  docs/02-learning-system.md §2.1.1 参照 (MVP は Tier 1 のみ)。
 */
export const TIER_1_DOMAIN_IDS = [
  "programming",
  "dsa",
  "network",
  "db",
  "tools",
  "frontend",
] as const satisfies readonly DomainId[];
export type Tier1DomainId = (typeof TIER_1_DOMAIN_IDS)[number];

export const QUESTION_TYPES = ["mcq", "short", "written", "cloze", "code_read", "design"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const THINKING_STYLES = [
  "why",
  "how",
  "trade_off",
  "edge_case",
  "compare",
  "apply",
] as const;
export type ThinkingStyle = (typeof THINKING_STYLES)[number];

export const WEBAUTHN_CHALLENGE_PURPOSES = ["register", "authenticate"] as const;
export type WebauthnChallengePurpose = (typeof WEBAUTHN_CHALLENGE_PURPOSES)[number];

export const CREDENTIAL_DEVICE_TYPES = ["singleDevice", "multiDevice"] as const;
export type CredentialDeviceType = (typeof CREDENTIAL_DEVICE_TYPES)[number];
