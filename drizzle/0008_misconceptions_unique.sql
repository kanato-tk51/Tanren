-- issue #19: misconceptions の description 完全一致で upsert できるよう
-- (user_id, concept_id, description) の unique index を追加。
-- これにより ON CONFLICT DO UPDATE で count 加算を原子的に実行できる。
--
-- 既存重複がある環境でも安全に適用できるよう、事前に dedupe を実施:
--   同一 (user_id, concept_id, description) のうち最古 (created_at 降順で最も小さい
--   firstSeen を代表) に count を集約し、他を削除する。
-- MVP 時点で misconceptions は空運用だが、防御的に保持する。

WITH ranked AS (
  SELECT
    id,
    user_id,
    concept_id,
    description,
    count,
    last_seen,
    first_seen,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, concept_id, description
      ORDER BY first_seen ASC, id ASC
    ) AS rn,
    SUM(count) OVER (PARTITION BY user_id, concept_id, description) AS total_count,
    MAX(last_seen) OVER (PARTITION BY user_id, concept_id, description) AS max_last_seen
  FROM misconceptions
)
UPDATE misconceptions m
SET
  count = r.total_count,
  last_seen = r.max_last_seen
FROM ranked r
WHERE m.id = r.id AND r.rn = 1;

DELETE FROM misconceptions
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, concept_id, description
        ORDER BY first_seen ASC, id ASC
      ) AS rn
    FROM misconceptions
  ) t
  WHERE t.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_misconceptions_user_concept_desc"
  ON "misconceptions" ("user_id", "concept_id", "description");
