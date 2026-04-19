-- issue #35: design 問題の対話採点用に attempts に dialogue jsonb を追加
ALTER TABLE "attempts"
  ADD COLUMN "dialogue" jsonb;
