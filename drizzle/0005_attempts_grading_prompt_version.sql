-- attempts に採点プロンプトの版を記録するカラムを追加。
-- mcq (LLM 未使用) では NULL、short/written などでは prompts/grading/*.vN.md の `vN` を記録。
ALTER TABLE "attempts" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "graded_by" text;
