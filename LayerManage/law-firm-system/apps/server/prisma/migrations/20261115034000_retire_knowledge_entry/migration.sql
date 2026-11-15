UPDATE permission SET status='DISABLED',"updatedAt"=CURRENT_TIMESTAMP WHERE code='menu.knowledge';
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,version,"createdAt","updatedAt") VALUES
('permission:knowledge.review','knowledge.review','审核知识投稿','ACTION','workspace','review','HIGH','ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT (code) DO UPDATE SET status='ENABLED',"updatedAt"=CURRENT_TIMESTAMP;
