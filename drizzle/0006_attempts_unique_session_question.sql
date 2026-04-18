-- 同じ session で同じ question への二重 submit (並行送信 / リトライ) を
-- DB 側でも防ぐ unique index。gradeAttempt 経路で insert 時に
-- onConflictDoNothing と組み合わせて使う。
CREATE UNIQUE INDEX "uq_attempts_session_question"
  ON "attempts" ("session_id", "question_id");
