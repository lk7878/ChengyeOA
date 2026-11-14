CREATE TABLE "mfa_factor" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'TOTP',
  "encryptedSecret" TEXT NOT NULL,
  "secretIv" TEXT NOT NULL,
  "secretAuthTag" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "verifiedAt" TIMESTAMPTZ(3),
  "lastAcceptedCounter" BIGINT,
  "disabledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "mfa_factor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mfa_recovery_code" (
  "id" TEXT NOT NULL,
  "factorId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_recovery_code_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_challenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_challenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "credentialVersion" INTEGER NOT NULL,
  "assuranceLevel" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "previousRefreshTokenHash" TEXT,
  "previousRefreshRotatedAt" TIMESTAMPTZ(3),
  "refreshGeneration" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "revokedReason" TEXT,
  "userAgentHash" TEXT,
  "ipPrefix" TEXT,
  CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "step_up_grant" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "targetDigest" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "step_up_grant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mfa_factor_one_active_per_user"
  ON "mfa_factor"("userId") WHERE "disabledAt" IS NULL;
CREATE INDEX "mfa_factor_userId_verifiedAt_disabledAt_idx"
  ON "mfa_factor"("userId", "verifiedAt", "disabledAt");
CREATE UNIQUE INDEX "mfa_recovery_code_codeHash_key" ON "mfa_recovery_code"("codeHash");
CREATE INDEX "mfa_recovery_code_factorId_usedAt_idx" ON "mfa_recovery_code"("factorId", "usedAt");
CREATE UNIQUE INDEX "auth_challenge_tokenHash_key" ON "auth_challenge"("tokenHash");
CREATE INDEX "auth_challenge_userId_type_createdAt_idx" ON "auth_challenge"("userId", "type", "createdAt");
CREATE INDEX "auth_challenge_expiresAt_consumedAt_idx" ON "auth_challenge"("expiresAt", "consumedAt");
CREATE UNIQUE INDEX "auth_session_refreshTokenHash_key" ON "auth_session"("refreshTokenHash");
CREATE UNIQUE INDEX "auth_session_previousRefreshTokenHash_key" ON "auth_session"("previousRefreshTokenHash");
CREATE INDEX "auth_session_userId_expiresAt_idx" ON "auth_session"("userId", "expiresAt");
CREATE INDEX "auth_session_revokedAt_expiresAt_idx" ON "auth_session"("revokedAt", "expiresAt");
CREATE UNIQUE INDEX "step_up_grant_tokenHash_key" ON "step_up_grant"("tokenHash");
CREATE INDEX "step_up_grant_sessionId_expiresAt_idx" ON "step_up_grant"("sessionId", "expiresAt");
CREATE INDEX "step_up_grant_userId_createdAt_idx" ON "step_up_grant"("userId", "createdAt");
CREATE INDEX "step_up_grant_expiresAt_consumedAt_idx" ON "step_up_grant"("expiresAt", "consumedAt");

ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_type_check"
  CHECK ("type" = 'TOTP');
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_key_version_positive"
  CHECK ("keyVersion" > 0);
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_last_counter_nonnegative"
  CHECK ("lastAcceptedCounter" IS NULL OR "lastAcceptedCounter" >= 0);
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_type_check"
  CHECK ("type" IN ('PASSWORD_CHANGE', 'MFA_ENROLLMENT', 'MFA_VERIFY'));
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_attempts_check"
  CHECK ("failedAttempts" >= 0 AND "maxAttempts" > 0 AND "failedAttempts" <= "maxAttempts");
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_assurance_level_check"
  CHECK ("assuranceLevel" IN ('PASSWORD', 'MFA'));
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_credential_version_positive"
  CHECK ("credentialVersion" > 0);
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_refresh_generation_positive"
  CHECK ("refreshGeneration" > 0);
ALTER TABLE "step_up_grant" ADD CONSTRAINT "step_up_grant_target_digest_check"
  CHECK ("targetDigest" ~ '^[0-9a-f]{64}$');
ALTER TABLE "step_up_grant" ADD CONSTRAINT "step_up_grant_token_hash_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_factorId_fkey"
  FOREIGN KEY ("factorId") REFERENCES "mfa_factor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "step_up_grant" ADD CONSTRAINT "step_up_grant_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "auth_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "step_up_grant" ADD CONSTRAINT "step_up_grant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
