BEGIN;
INSERT INTO operation_log (id,action,"targetType","targetId","oldValues","newValues")
SELECT md5('retirement-legacy:'||id),'MODULE_RETIRED','APPROVAL_INSTANCE',id,
 jsonb_build_object('status',status,'version',version)::text,
 '{"reason":"质量管理和SOP整体停用，解除待办并归档"}'
FROM approval_instance WHERE "businessType" IN ('SOP_REVIEW','QUALITY_ANALYSIS') AND status='PENDING';
UPDATE approval_task SET status='CANCELLED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP,
 "processedAt"=CURRENT_TIMESTAMP,remark='模块停用，解除待办'
WHERE status='PENDING' AND "instanceId" IN
 (SELECT id FROM approval_instance WHERE "businessType" IN ('SOP_REVIEW','QUALITY_ANALYSIS'));
UPDATE approval_instance SET status='WITHDRAWN',version=version+1,"updatedAt"=CURRENT_TIMESTAMP
WHERE "businessType" IN ('SOP_REVIEW','QUALITY_ANALYSIS') AND status='PENDING';
UPDATE notification SET "isRead"=true
WHERE "isRead"=false AND ("routeUrl" LIKE '/sop/%' OR "routeUrl" LIKE '/quality/%');
COMMIT;
