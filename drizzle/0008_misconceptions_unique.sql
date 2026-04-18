-- issue #19: misconceptions の description 完全一致で upsert できるよう
-- (user_id, concept_id, description) の unique index を追加。
-- これにより ON CONFLICT DO UPDATE で count 加算を原子的に実行できる。
--
-- 既存重複がある環境では失敗するが、本 issue 実装時点では
-- misconceptions テーブルは空運用のため問題なし。
CREATE UNIQUE INDEX IF NOT EXISTS "uq_misconceptions_user_concept_desc"
  ON "misconceptions" ("user_id", "concept_id", "description");
