-- CreateTable
CREATE TABLE "case_pay_policy" (
    "teamId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "basis" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "directorId" TEXT NOT NULL,
    "financeIds" TEXT[],

    CONSTRAINT "case_pay_policy_pkey" PRIMARY KEY ("teamId")
);

-- CreateTable
CREATE TABLE "case_settlement" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "contractId" TEXT,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "basisAmount" DECIMAL(18,2) NOT NULL,
    "pool" DECIMAL(18,2) NOT NULL,
    "remark" TEXT NOT NULL DEFAULT '',
    "payrollId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_pay_line" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "adjustment" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "case_pay_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_pay_share" (
    "settlementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_pay_share_pkey" PRIMARY KEY ("settlementId","userId")
);

-- CreateIndex
CREATE INDEX "case_settlement_caseId_status_idx" ON "case_settlement"("caseId", "status");

-- CreateIndex
CREATE INDEX "case_settlement_payrollId_idx" ON "case_settlement"("payrollId");

-- CreateIndex
CREATE INDEX "case_settlement_period_status_idx" ON "case_settlement"("period", "status");

-- CreateIndex
CREATE INDEX "case_settlement_contractId_idx" ON "case_settlement"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "case_settlement_teamId_caseId_period_key" ON "case_settlement"("teamId", "caseId", "period");

-- CreateIndex
CREATE INDEX "case_pay_line_employeeId_idx" ON "case_pay_line"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "case_pay_line_settlementId_employeeId_key" ON "case_pay_line"("settlementId", "employeeId");

-- CreateIndex
CREATE INDEX "case_pay_share_userId_expiresAt_idx" ON "case_pay_share"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "case_pay_policy" ADD CONSTRAINT "case_pay_policy_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "professional_team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_pay_policy" ADD CONSTRAINT "case_pay_policy_directorId_fkey" FOREIGN KEY ("directorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_settlement" ADD CONSTRAINT "case_settlement_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_settlement" ADD CONSTRAINT "case_settlement_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_settlement" ADD CONSTRAINT "case_settlement_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "professional_team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_settlement" ADD CONSTRAINT "case_settlement_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "payroll_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_pay_line" ADD CONSTRAINT "case_pay_line_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "case_settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_pay_line" ADD CONSTRAINT "case_pay_line_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_pay_share" ADD CONSTRAINT "case_pay_share_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "case_settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_pay_share" ADD CONSTRAINT "case_pay_share_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Place the new table alongside the existing case entry in configured menus.
UPDATE navigation_menu m SET nodes = nodes || jsonb_build_array(jsonb_build_object(
 'id','entry-/case-performance','target','/case-performance','label','案件绩效',
 'parentId', n.node->'parentId','position',(n.node->>'position')::int + 1)),
 version=version+1, "updatedAt"=CURRENT_TIMESTAMP
FROM (SELECT id, el AS node FROM navigation_menu, LATERAL jsonb_array_elements(nodes) el
      WHERE el->>'target'='/cases' LIMIT 1) n
WHERE m.id=n.id AND NOT m.nodes @> '[{"target":"/case-performance"}]'::jsonb;
