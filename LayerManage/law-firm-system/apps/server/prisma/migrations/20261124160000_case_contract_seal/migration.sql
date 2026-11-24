ALTER TABLE "case_registration" ADD COLUMN "numberCode" TEXT, ADD COLUMN "sealReviewerId" TEXT;
CREATE TABLE "case_contract_number" ("number" TEXT PRIMARY KEY, "caseId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "case_contract_number_caseId_idx" ON "case_contract_number"("caseId");
CREATE TABLE "case_seal_request" (
 "id" TEXT PRIMARY KEY, "caseId" TEXT NOT NULL UNIQUE, "contractId" TEXT NOT NULL UNIQUE,
 "registrationId" TEXT NOT NULL UNIQUE, "assigneeId" TEXT NOT NULL, "submittedBy" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "snapshot" JSONB NOT NULL, "stampedFileIds" JSONB NOT NULL DEFAULT '[]',
 "stampedAt" TIMESTAMP(3), "stampedBy" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "case_seal_request_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "case_seal_request_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "case_seal_request_assigneeId_status_idx" ON "case_seal_request"("assigneeId", "status");
INSERT INTO permission (id, code, name, type, resource, action, "riskLevel", status, "createdAt", "updatedAt")
VALUES ('permission:case.seal.manage','case.seal.manage','案件合同编号核对与盖章','ACTION','case','seal.manage','HIGH','ENABLED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;

UPDATE navigation_menu m SET nodes = nodes || jsonb_build_array(jsonb_build_object(
 'id','entry-/case-seals','target','/case-seals','label','合同核对与盖章',
 'parentId', n.node->'parentId','position',(n.node->>'position')::int + 2)),
 version=version+1, "updatedAt"=CURRENT_TIMESTAMP
FROM (SELECT id, el AS node FROM navigation_menu, LATERAL jsonb_array_elements(nodes) el
      WHERE el->>'target'='/cases' LIMIT 1) n
WHERE m.id=n.id AND NOT m.nodes @> '[{"target":"/case-seals"}]'::jsonb;
