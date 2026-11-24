CREATE TABLE "case_source" ("name" TEXT PRIMARY KEY, "enabled" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO "case_source" ("name") VALUES ('个人'), ('大数据中心'), ('侵权中心'), ('律师部'), ('门市');
-- Add the new projection without changing any existing case values or authorization.
INSERT INTO "collab_field" ("id", "tableId", "name", "type", "options", "position", "required", "archived")
SELECT md5('case-source:' || t.id)::uuid::text, t.id,
 CASE WHEN EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND f.name='案件来源' AND NOT f.archived) THEN '案件来源（业务字典）' ELSE '案件来源' END,
 'SINGLE_SELECT', '{"businessKey":"intake.caseSource","businessSource":"CASES"}'::jsonb,
 COALESCE((SELECT MAX(f.position)+1 FROM collab_field f WHERE f."tableId"=t.id),0),false,false
FROM collab_table t WHERE t.source='CASES' AND NOT EXISTS (SELECT 1 FROM collab_field f WHERE f."tableId"=t.id AND f.options->>'businessKey'='intake.caseSource');
-- Default shared views gain the column. Personal views retain their configuration.
UPDATE collab_view v SET config=jsonb_set(v.config,'{visibleFields}',(v.config->'visibleFields') || jsonb_build_array(f.id)), version=v.version+1
FROM collab_field f WHERE f."tableId"=v."tableId" AND f.options->>'businessKey'='intake.caseSource'
 AND v."isDefault" AND v.shared AND jsonb_typeof(v.config->'visibleFields')='array'
 AND NOT (v.config->'visibleFields' @> jsonb_build_array(f.id));
UPDATE collab_table SET "schemaVersion"="schemaVersion"+1 WHERE source='CASES';
UPDATE collab_field f SET name='案件归属组织' FROM collab_table t
WHERE t.id=f."tableId" AND t.source='CASES' AND f.options->>'businessKey'='branchId' AND f.name='所属组织'
AND NOT EXISTS (SELECT 1 FROM collab_field existing WHERE existing."tableId"=t.id AND existing.name='案件归属组织' AND NOT existing.archived);
