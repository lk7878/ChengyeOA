INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES
('permission:customer.delete','customer.delete','删除客户','ACTION','customer','delete','HIGH',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(code) DO NOTHING;
