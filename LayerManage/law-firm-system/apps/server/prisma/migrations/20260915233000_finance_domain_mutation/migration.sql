CREATE TABLE "domain_mutation" (
 "id" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 "key" TEXT NOT NULL,
 "operation" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,
 "targetId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "domain_mutation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "domain_mutation_actorId_key_key" ON "domain_mutation"("actorId", "key");
CREATE INDEX "domain_mutation_targetId_idx" ON "domain_mutation"("targetId");
