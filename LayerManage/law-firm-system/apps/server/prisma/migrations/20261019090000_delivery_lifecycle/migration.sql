ALTER TABLE "collab_table" ADD COLUMN "lifecycleKind" TEXT;
CREATE TABLE "collab_lifecycle_link" (
 "recordId" TEXT PRIMARY KEY REFERENCES "collab_record"("id") ON DELETE CASCADE,
 "tableId" TEXT NOT NULL,
 "caseId" TEXT NOT NULL REFERENCES "case"("id") ON DELETE RESTRICT,
 "parentRecordId" TEXT REFERENCES "collab_record"("id") ON DELETE RESTRICT,
 "status" TEXT NOT NULL DEFAULT 'OPEN',
 "kind" TEXT NOT NULL CHECK ("kind" IN ('AFTER_SALES', 'CASE_REFUNDS')),
 CONSTRAINT "lifecycle_parent_kind" CHECK (("kind" = 'AFTER_SALES' AND "parentRecordId" IS NULL) OR ("kind" = 'CASE_REFUNDS' AND "parentRecordId" IS NOT NULL))
);
CREATE UNIQUE INDEX "collab_lifecycle_link_tableId_caseId_key" ON "collab_lifecycle_link"("tableId", "caseId");
CREATE INDEX "collab_lifecycle_link_parentRecordId_idx" ON "collab_lifecycle_link"("parentRecordId");

INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES
('permission:negotiation.delete','negotiation.delete','删除谈案','ACTION','negotiation','delete','HIGH',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;

INSERT INTO collab_field (id,"tableId",name,type,options,required,position,archived) SELECT 'lifecycle:'||t.id||':contractNo',t.id,'合同编号（同步）','TEXT',jsonb_build_object('businessKey','contractNo','businessSource','CASES'),false,100,false FROM collab_table t WHERE t.source='CASES' AND NOT EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND (f.options->>'businessKey'='contractNo' OR f.name='合同编号（同步）')) ON CONFLICT DO NOTHING;
INSERT INTO collab_field (id,"tableId",name,type,options,required,position,archived) SELECT 'lifecycle:'||t.id||':contractAmount',t.id,'合同金额（同步）','CURRENCY',jsonb_build_object('businessKey','contractAmount','businessSource','CASES'),false,100,false FROM collab_table t WHERE t.source='CASES' AND NOT EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND (f.options->>'businessKey'='contractAmount' OR f.name='合同金额（同步）')) ON CONFLICT DO NOTHING;
INSERT INTO collab_field (id,"tableId",name,type,options,required,position,archived) SELECT 'lifecycle:'||t.id||':customerName',t.id,'客户名称（同步）','TEXT',jsonb_build_object('businessKey','customerName','businessSource','CASES'),false,100,false FROM collab_table t WHERE t.source='CASES' AND NOT EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND (f.options->>'businessKey'='customerName' OR f.name='客户名称（同步）')) ON CONFLICT DO NOTHING;
INSERT INTO collab_field (id,"tableId",name,type,options,required,position,archived) SELECT 'lifecycle:'||t.id||':negotiationId',t.id,'关联谈案','TEXT',jsonb_build_object('businessKey','negotiationId','businessSource','CONTRACTS'),false,100,false FROM collab_table t WHERE t.source='CONTRACTS' AND NOT EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND (f.options->>'businessKey'='negotiationId' OR f.name='关联谈案')) ON CONFLICT DO NOTHING;
INSERT INTO collab_field (id,"tableId",name,type,options,required,position,archived) SELECT 'lifecycle:'||t.id||':negotiationNo',t.id,'谈案编号（同步）','TEXT',jsonb_build_object('businessKey','negotiationNo','businessSource','CONTRACTS'),false,100,false FROM collab_table t WHERE t.source='CONTRACTS' AND NOT EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND (f.options->>'businessKey'='negotiationNo' OR f.name='谈案编号（同步）')) ON CONFLICT DO NOTHING;
INSERT INTO collab_field (id,"tableId",name,type,options,required,position,archived) SELECT 'lifecycle:'||t.id||':quotedAmount',t.id,'谈案报价（同步）','CURRENCY',jsonb_build_object('businessKey','quotedAmount','businessSource','CONTRACTS'),false,100,false FROM collab_table t WHERE t.source='CONTRACTS' AND NOT EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND (f.options->>'businessKey'='quotedAmount' OR f.name='谈案报价（同步）')) ON CONFLICT DO NOTHING;
INSERT INTO collab_field (id,"tableId",name,type,options,required,position,archived) SELECT 'lifecycle:'||t.id||':customerName',t.id,'客户名称（同步）','TEXT',jsonb_build_object('businessKey','customerName','businessSource','CONTRACTS'),false,100,false FROM collab_table t WHERE t.source='CONTRACTS' AND NOT EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND (f.options->>'businessKey'='customerName' OR f.name='客户名称（同步）')) ON CONFLICT DO NOTHING;
INSERT INTO collab_field (id,"tableId",name,type,options,required,position,archived) SELECT 'lifecycle:'||t.id||':customerName',t.id,'客户名称（同步）','TEXT',jsonb_build_object('businessKey','customerName','businessSource','NEGOTIATIONS'),false,100,false FROM collab_table t WHERE t.source='NEGOTIATIONS' AND NOT EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND (f.options->>'businessKey'='customerName' OR f.name='客户名称（同步）')) ON CONFLICT DO NOTHING;
UPDATE collab_table SET "schemaVersion"="schemaVersion"+1 WHERE source IN ('CASES','CONTRACTS','NEGOTIATIONS');
