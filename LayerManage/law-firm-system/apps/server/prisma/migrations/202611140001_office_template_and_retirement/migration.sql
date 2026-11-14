BEGIN;
ALTER TABLE "role" ADD COLUMN "officeTemplateSnapshot" JSONB;
CREATE TABLE "office_role_template" (
  "id" TEXT PRIMARY KEY DEFAULT 'basic', "permissionCodes" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO office_role_template (id, "permissionCodes") VALUES
 ('basic', '["approval.read","approval.apply","approval.process","menu.security_my_access","permission.trace.self"]');
-- Preserve the original pending state in the workflow audit before releasing retired tasks.
INSERT INTO workflow_log (id,"instanceId","nodeId",action,remark,changes)
SELECT md5('retirement-20261114:'||id),id,"currentNode",'MODULE_RETIRED',
 '质量管理和SOP整体停用，解除待办，历史流程归档',
 jsonb_build_object('status',status,'version',version)
FROM workflow_instance WHERE "businessType" IN ('SOP_REVIEW','QUALITY_ANALYSIS') AND status='PENDING';
UPDATE workflow_task SET status='CANCELLED',"processedAt"=CURRENT_TIMESTAMP,
 remark='模块停用，解除待办'
WHERE status IN ('PENDING','WAITING') AND "instanceId" IN
 (SELECT id FROM workflow_instance WHERE "businessType" IN ('SOP_REVIEW','QUALITY_ANALYSIS'));
UPDATE workflow_delivery SET status='CANCELLED',error='MODULE_RETIRED'
WHERE status IN ('PENDING','FAILED') AND "instanceId" IN
 (SELECT id FROM workflow_instance WHERE "businessType" IN ('SOP_REVIEW','QUALITY_ANALYSIS'));
UPDATE workflow_instance SET status='WITHDRAWN',version=version+1,"finishedAt"=CURRENT_TIMESTAMP,
 "updatedAt"=CURRENT_TIMESTAMP,"syncStatus"='SYNCED',"syncError"=NULL
WHERE "businessType" IN ('SOP_REVIEW','QUALITY_ANALYSIS') AND status='PENDING';

COMMIT;
