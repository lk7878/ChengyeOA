INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES
('permission:menu.knowledge','menu.knowledge','个人知识库','MENU','menu','view','LOW','/knowledge','ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('permission:menu.smart_case','menu.smart_case','智慧办案','MENU','menu','view','LOW','/smart-case','ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;
