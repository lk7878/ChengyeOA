INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES
('permission:case.delete','case.delete','删除案件','ACTION','case','delete','HIGH',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(code) DO NOTHING;
