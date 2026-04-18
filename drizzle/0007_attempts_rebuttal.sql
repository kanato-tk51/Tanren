-- issue #15: attempts に再採点 (rebuttal) の記録カラムを追加
-- rebuttal: 反論の概要 (元の判定、反論メッセージ、反論後に結論が変わったかなど)
-- コスト: jsonb は NULL のときは実質データなし。マイグレーションは非破壊
ALTER TABLE "attempts" ADD COLUMN "rebuttal" jsonb;
