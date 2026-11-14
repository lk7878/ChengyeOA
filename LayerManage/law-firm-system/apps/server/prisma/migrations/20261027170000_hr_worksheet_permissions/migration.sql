INSERT INTO permission(id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES
('permission:hr.worksheet.read','hr.worksheet.read','查看人力资源表','ACTION','workspace','read','HIGH','ENABLED',CURRENT_TIMESTAMP),
('permission:hr.worksheet.manage','hr.worksheet.manage','维护人力资源表','ACTION','workspace','manage','HIGH','ENABLED',CURRENT_TIMESTAMP),
('permission:hr.worksheet.sensitive','hr.worksheet.sensitive','查看及填写人事敏感信息','ACTION','workspace','sensitive','HIGH','ENABLED',CURRENT_TIMESTAMP)
ON CONFLICT(code) DO NOTHING;
