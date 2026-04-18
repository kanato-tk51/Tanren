-- issue #30: 全文検索の本格チューニング (tsvector + pg_trgm)。
--
-- 目的:
--   - 日本語 (CJK) はホワイトスペース境界が無く to_tsvector('simple', ...) では
--     部分一致しないため、pg_trgm の GIN 索引で ILIKE を高速化する。
--   - 英語/英数字中心のクエリは既存 attempts.search_tsv + GIN を活用できるよう
--     questions.prompt と misconceptions.description にも同じ仕組みを追加。
--
-- pg_trgm 拡張は 0000_initial_schema.sql で既に有効化済み。

-- attempts.feedback の ILIKE 高速化 (既に user_answer は idx_attempts_trgm で張られている)
CREATE INDEX IF NOT EXISTS "idx_attempts_feedback_trgm"
  ON "attempts" USING gin ("feedback" gin_trgm_ops);

-- questions.prompt の ILIKE 高速化
CREATE INDEX IF NOT EXISTS "idx_questions_prompt_trgm"
  ON "questions" USING gin ("prompt" gin_trgm_ops);

-- misconceptions.description の ILIKE 高速化
CREATE INDEX IF NOT EXISTS "idx_misconceptions_description_trgm"
  ON "misconceptions" USING gin ("description" gin_trgm_ops);

-- questions に英語向け tsvector を追加 (prompt + answer を対象)
ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(prompt, '') || ' ' || coalesce(answer, ''))) STORED;
CREATE INDEX IF NOT EXISTS "idx_questions_search_tsv"
  ON "questions" USING gin ("search_tsv");

-- misconceptions にも同様に
ALTER TABLE "misconceptions"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(description, ''))) STORED;
CREATE INDEX IF NOT EXISTS "idx_misconceptions_search_tsv"
  ON "misconceptions" USING gin ("search_tsv");
