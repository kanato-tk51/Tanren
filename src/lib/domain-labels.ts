import type { DomainId } from "@/db/schema";

/** UI 上で 13 ドメインを表示するときの英語ラベル。docs/02-learning-system.md §2.1.1 の
 *  ドメイン名に合わせる。Home / Deep Dive / Onboarding から同じ import で参照する
 *  (Codex PR#85 Round 1 指摘 #2: 以前は 2 ファイルに似たような Record が散らばっていた)。 */
export const DOMAIN_LABELS: Record<DomainId, string> = {
  programming: "Programming",
  dsa: "DSA",
  os: "OS",
  network: "Network",
  db: "Database",
  security: "Security",
  distributed: "Distributed",
  design: "Design",
  devops: "DevOps",
  tools: "Tools",
  low_level: "Low-level",
  ai_ml: "AI / ML",
  frontend: "Frontend",
};
