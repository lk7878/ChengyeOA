INSERT INTO "permission" (id,code,name,type,resource,action,"riskLevel",path,status,"updatedAt")
VALUES ('permission:inventory.seal.review','inventory.seal.review','用印审核','ACTION','inventory','seal.review','HIGH',NULL,'ENABLED',CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;
