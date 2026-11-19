BEGIN;
LOCK TABLE case_settlement, case_pay_policy IN ACCESS EXCLUSIVE MODE;
-- Reject conflicting history before making any changes.
CREATE UNIQUE INDEX "case_settlement_caseId_key" ON case_settlement ("caseId");
DROP INDEX "case_settlement_teamId_caseId_period_key";
ALTER TABLE case_pay_policy ADD COLUMN "scopeId" TEXT, ADD COLUMN "employeeId" TEXT REFERENCES employee(id) ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE case_pay_policy SET "scopeId" = "teamId";
ALTER TABLE case_pay_policy DROP CONSTRAINT case_pay_policy_pkey,
  ALTER COLUMN "teamId" DROP NOT NULL, ADD PRIMARY KEY ("scopeId");
CREATE UNIQUE INDEX "case_pay_policy_teamId_key" ON case_pay_policy ("teamId");
CREATE UNIQUE INDEX "case_pay_policy_employeeId_key" ON case_pay_policy ("employeeId");
ALTER TABLE case_pay_policy ADD CHECK (
  ("teamId" IS NOT NULL AND "employeeId" IS NULL AND "scopeId" = "teamId") OR
  ("teamId" IS NULL AND "scopeId" = COALESCE('personal:' || "employeeId", 'personal'))
);
ALTER TABLE case_settlement ALTER COLUMN "teamId" DROP NOT NULL,
  ADD COLUMN "ownerEmployeeId" TEXT REFERENCES employee(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "policyId" TEXT,
  ADD COLUMN "allocatedCost" DECIMAL(18,2) NOT NULL DEFAULT 0;
UPDATE case_settlement SET "policyId" = "teamId";
ALTER TABLE case_settlement ALTER COLUMN "policyId" SET NOT NULL,
  ADD FOREIGN KEY ("policyId") REFERENCES case_pay_policy("scopeId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CHECK (("teamId" IS NULL) <> ("ownerEmployeeId" IS NULL));
CREATE TABLE case_pay_month_cost (
  scope TEXT NOT NULL, period TEXT NOT NULL, amount DECIMAL(18,2) NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(scope, period)
);
COMMIT;
