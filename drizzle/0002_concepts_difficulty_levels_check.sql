-- concepts.difficulty_levels が空/NULL にならないよう CHECK 制約を追加。
-- Zod 層 (src/db/seed/schema.ts) と Drizzle 型定義で同じ不変条件を持つため三重整合を保つ。
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_difficulty_levels_nonempty_chk"
  CHECK (
    jsonb_typeof(difficulty_levels) = 'array'
    AND jsonb_array_length(difficulty_levels) >= 1
  );
