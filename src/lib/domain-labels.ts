import type { DomainId } from "@/db/schema";

/** ドメインの UI 表示名。13 ドメインすべてをカバーする。
 *  複数画面 (Home / Deep Dive / Onboarding) で同じ表記を使い、表記ブレを防ぐ。
 */
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

export function domainLabel(id: DomainId): string {
  return DOMAIN_LABELS[id];
}
