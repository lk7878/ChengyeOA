CREATE TABLE "contract_read_grant" (
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "contractId" TEXT NOT NULL REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", "contractId")
);
CREATE INDEX "contract_read_grant_contractId_idx" ON "contract_read_grant"("contractId");
