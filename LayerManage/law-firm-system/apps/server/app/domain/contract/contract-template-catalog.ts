// SPEC-010 终审修复轮 F-3：CON-01 合同模板供给目录常量。
// 形态沿 app/domain/events/event-subscription-catalog.ts（SPEC-009 F-1 先例）：
// 独立文件承载迁移-only 供给的单一事实源（本仓无种子通道，迁移为唯一供给机制——
// 同 20260730090000_crm_permission_provision 纪律）。
// prisma/migrations/20260731090000_contract_template_provision 的供给行必须与本目录
// 逐字段 parity，由 test/db/spec-010-contract-template-provision-contract.test.ts
// 常驻钉死（双向：目录每条目须有 INSERT 行；INSERT 行数须等于目录长度）。
// 恰两行（协调者裁决：SUPPLEMENT 引用被扩展模板族、RISK_NOTICE 无模板设计）。
// 字段范围 = 业务探针与供给实证关心的键集（code/contractType/version/enabled/createdBy）；
// id/name/content 为迁移实现细节，不入目录（name/content 为模板文案，非契约面）。

export interface ContractTemplateCatalogEntry {
  readonly code: string;
  readonly contractType: 'FIRST_SIGN' | 'FORMAL';
  readonly version: number;
  readonly enabled: boolean;
  readonly createdBy: 'system';
}

export const CONTRACT_TEMPLATE_CATALOG = Object.freeze([
  Object.freeze({
    code: 'FIRST_SIGN_STANDARD',
    contractType: 'FIRST_SIGN',
    version: 1,
    enabled: true,
    createdBy: 'system',
  }),
  Object.freeze({
    code: 'FORMAL_STANDARD',
    contractType: 'FORMAL',
    version: 1,
    enabled: true,
    createdBy: 'system',
  }),
] satisfies readonly ContractTemplateCatalogEntry[]);
