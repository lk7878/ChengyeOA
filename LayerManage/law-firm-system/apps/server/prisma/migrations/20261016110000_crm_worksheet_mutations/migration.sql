ALTER TABLE lead_follow ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES
('permission:lead.delete','lead.delete','删除线索','ACTION','lead','delete','HIGH',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('permission:lead.follow.delete','lead.follow.delete','删除跟进记录','ACTION','lead','follow.delete','HIGH',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(code) DO NOTHING;
