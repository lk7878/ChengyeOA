ALTER TABLE "auth_session"
  ADD COLUMN "stepUpFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stepUpBlockedUntil" TIMESTAMPTZ(3);

ALTER TABLE "auth_session"
  ADD CONSTRAINT "auth_session_step_up_attempts_check"
  CHECK ("stepUpFailedAttempts" >= 0 AND "stepUpFailedAttempts" <= 5);
