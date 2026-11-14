INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES
('permission:contract.update','contract.update','修改合同','ACTION','contract','update','MEDIUM',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('permission:contract.delete','contract.delete','删除合同','ACTION','contract','delete','HIGH',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(code) DO NOTHING;
