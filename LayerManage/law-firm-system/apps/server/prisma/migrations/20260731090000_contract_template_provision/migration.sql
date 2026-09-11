-- SPEC-010 CON-01: contract template provisioning (Task 7).
-- Seeds one enabled v1 template per template-bearing contract type (FIRST_SIGN / FORMAL)
-- so createContract templateCode references resolve on migration-only databases (this
-- repo has no seed channel; migrations are the only provisioning mechanism — same
-- discipline as 20260730090000_crm_permission_provision).
-- id values are explicit because TEXT id columns carry no database default (Prisma
-- @default(uuid()) is client-side only, confirmed in 20260730120000); "updatedAt" is
-- NOT NULL without a database default, so it is set explicitly as well.
-- ON CONFLICT ("code") DO NOTHING keeps the statement idempotent. SUPPLEMENT contracts
-- reference whichever template family they extend at call time and RISK_NOTICE is
-- template-free by design, so exactly two rows are provisioned.

INSERT INTO "contract_template" (
  "id", "code", "contractType", "name", "content", "version", "enabled", "createdBy", "updatedBy", "createdAt", "updatedAt"
) VALUES
  ('6d3a2c10-4f51-4b0e-9f60-02f0a1c00001', 'FIRST_SIGN_STANDARD', 'FIRST_SIGN', '首签标准合同模板', '【首签标准合同】甲方（客户）与乙方（律所）就委托事项达成一致，服务内容、收费方式及双方权利义务以本模板条款为准。', 1, true, 'system', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('6d3a2c10-4f51-4b0e-9f60-02f0a1c00002', 'FORMAL_STANDARD', 'FORMAL', '正式委托合同标准模板', '【正式委托合同】甲方（客户）委托乙方（律所）代理案件，委托范围、代理权限、收费标准与支付方式、违约责任等以本模板条款为准。', 1, true, 'system', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
