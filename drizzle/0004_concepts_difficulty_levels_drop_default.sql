-- difficulty_levels に残っていた DEFAULT '[]' を外す。
-- NOT NULL + CHECK (jsonb_array_length >= 1) との自己矛盾 (insert 省略時に default '[]' が CHECK に落ちる)
-- を避け、省略は常に insert エラーになるよう揃える。
ALTER TABLE "concepts" ALTER COLUMN "difficulty_levels" DROP DEFAULT;
