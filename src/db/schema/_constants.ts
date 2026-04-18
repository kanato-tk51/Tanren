/**
 * 13 ドメインのマスタは YAML (`src/db/seed/concepts.yaml`) が正。
 * ここでは TypeScript 側で型を締めるための列挙だけを定義する。
 * docs/06-architecture.md §6.2.2 に準拠。
 */
export const DOMAIN_IDS = [
  "programming",
  "typesystem",
  "algorithm",
  "data_structure",
  "database",
  "network",
  "os_runtime",
  "distributed",
  "security",
  "web",
  "architecture",
  "testing",
  "devops",
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

export const SESSION_KINDS = ["daily", "deep", "custom", "review"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

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
