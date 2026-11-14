BEGIN;
CREATE TABLE navigation_menu (id TEXT PRIMARY KEY DEFAULT 'business', version INTEGER NOT NULL DEFAULT 1, nodes JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE personal_file (id TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT, "parentId" TEXT REFERENCES personal_file(id) ON DELETE RESTRICT, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('FILE','FOLDER')), "storageKey" TEXT, size INTEGER NOT NULL DEFAULT 0 CHECK(size>=0), "accessPolicy" JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX personal_file_owner_parent ON personal_file("ownerId","parentId");

ALTER TABLE collab_table ADD COLUMN "followSupportKind" TEXT;
ALTER TABLE collab_table ADD COLUMN "originBaseId" TEXT REFERENCES collab_base(id) ON DELETE RESTRICT;
UPDATE collab_table t SET "followSupportKind"='MEDICAL_ASSESSMENT' WHERE t.source='CUSTOM' AND
  (SELECT count(DISTINCT name) FROM collab_field WHERE "tableId"=t.id AND NOT archived AND name IN ('患者姓名','案件评估','医疗记录（病历）'))=3;
UPDATE collab_field SET position=position+1 WHERE position>=1 AND "tableId" IN (SELECT id FROM collab_table WHERE "followSupportKind"='MEDICAL_ASSESSMENT');
INSERT INTO collab_field (id,"tableId",name,type,options,required,position,archived) SELECT gen_random_uuid()::text,id,'关联客户','TEXT','{"medicalRelation":true}',false,1,false FROM collab_table WHERE "followSupportKind"='MEDICAL_ASSESSMENT';
UPDATE collab_field f SET options=options||jsonb_build_object('medicalAutofill',CASE name WHEN '患者姓名' THEN 'customerName' WHEN '微信名' THEN 'wechat' WHEN '抖音号' THEN 'douyinName' WHEN '联系电话' THEN 'phone' WHEN '地区' THEN 'region' END)
 WHERE "tableId" IN(SELECT id FROM collab_table WHERE "followSupportKind"='MEDICAL_ASSESSMENT') AND name IN ('患者姓名','微信名','抖音号','联系电话','地区');

-- Existing column selections remain intact, expose the new relation in default views.
UPDATE collab_view v SET config=jsonb_set(v.config,'{visibleFields}',(v.config->'visibleFields')||jsonb_build_array(f.id)), version=v.version+1
FROM collab_field f WHERE f."tableId"=v."tableId" AND f.options->>'medicalRelation'='true'
  AND v."isDefault"=true AND jsonb_typeof(v.config->'visibleFields')='array';
UPDATE collab_table SET "schemaVersion"="schemaVersion"+1 WHERE "followSupportKind"='MEDICAL_ASSESSMENT';
COMMIT;
