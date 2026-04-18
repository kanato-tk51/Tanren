import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import { describe, it, expect } from "vitest";

import { toConceptRow } from "./build-rows";
import { SeedFileSchema } from "./schema";

describe("seed file", () => {
  const file = resolve(process.cwd(), "src/db/seed/concepts.yaml");
  const raw = readFileSync(file, "utf8");
  const parsed = SeedFileSchema.parse(parseYaml(raw));

  it("YAML が Zod スキーマで通る (>=10 concept)", () => {
    expect(parsed.concepts.length).toBeGreaterThanOrEqual(10);
  });

  it("concept id は重複しない", () => {
    const ids = parsed.concepts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prereqs は全て YAML 内に存在", () => {
    const known = new Set(parsed.concepts.map((c) => c.id));
    for (const c of parsed.concepts) {
      for (const p of c.prereqs) {
        expect(known.has(p)).toBe(true);
      }
    }
  });

  it("toConceptRow が Drizzle 形式に正しく変換する (domainId / difficultyLevels / snake->camel)", () => {
    const sample = parsed.concepts.find((c) => c.id === "network.http.methods_idempotency");
    expect(sample).toBeDefined();
    const row = toConceptRow(sample!);
    expect(row.id).toBe("network.http.methods_idempotency");
    expect(row.domainId).toBe("network");
    expect(row.subdomainId).toBe("http");
    expect(row.difficultyLevels).toEqual(["beginner", "junior"]);
    expect(row.prereqs).toEqual([]);
  });

  it("prereqs を持つ concept も Drizzle 形式で引き回せる", () => {
    const sample = parsed.concepts.find((c) => c.id === "programming.async.promise_async_await");
    expect(sample).toBeDefined();
    const row = toConceptRow(sample!);
    expect(row.prereqs).toEqual(["programming.async.event_loop"]);
  });
});
