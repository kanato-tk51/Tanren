-- CHECK 式は NULL 評価だと通るため、カラム自体も NOT NULL にして完全に塞ぐ。
-- 既存行はいずれも difficulty_levels が埋まっている (seed / schema.default で [])。
ALTER TABLE "concepts" ALTER COLUMN "difficulty_levels" SET NOT NULL;
