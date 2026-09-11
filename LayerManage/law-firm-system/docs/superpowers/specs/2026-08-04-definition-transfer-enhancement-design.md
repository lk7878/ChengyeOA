# SPEC-029 Definition 导入导出增强（Transfer Enhancement）设计

日期：2026-08-04 ｜ 状态：用户授权自主推进 ｜ 需求来源：SPEC-025 closeout §9「Definition 导入导出增强——格式版本 / 增量导出 / 关联角色供给」+ SPEC-028 §9 承接
设计权威：本文档 ｜ 前置：SPEC-025（exportDefinitions/importDefinitions 基座）、SPEC-015（bootstrap 角色供给 HR/SEAL_ADMIN/FINANCE/PARTNER/MANAGER）

## 1. 背景与目标

SPEC-025 提供 Definition 全量导出/导入（配置迁移）。但三处增强需求：
1. **增量导出**：全量导出大库不便——按 code 列表 / businessType 筛选选择性导出。
2. **格式版本**：导出 payload 无版本标识——跨版本升级后导入旧快照可能语义漂移。加 `schemaVersion`（当前 1）导出携带 + 导入校验（版本 1 兼容；未知版本 → 400）。
3. **关联角色供给**：定义 approverRule 引用 roleCodes（HR/SEAL_ADMIN 等）——导入到新环境若角色不存在，审批人解析失败。导入时校验引用角色存在性（缺失 → 400 明确报错；或提示先跑 bootstrap 供给）。

**目标**：三增强落地，保持向后兼容（旧导出无 schemaVersion 视为 1 兼容）。**零结构变更**。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 增量导出 | `exportDefinitions(query)`——可选 `codes`（逗号分隔 code 列表，≤100）+ `businessType`（枚举）筛选；缺省全量（含 DISABLED，code 升序——向后兼容） |
| D2 | 格式版本 | export payload 增 `schemaVersion: 1` 顶层字段；import 兼容无 schemaVersion（视为 1）；`schemaVersion !== 1` → 400 `VALIDATION_FAILED`（未来版本格式） |
| D3 | 关联角色供给校验 | import 逐定义解析 approverRule.roleCodes → 校验角色存在（status ENABLED）；缺失 → 400 明确报错（含缺失角色码）；**不自动建角色**（沿 bootstrap 供给纪律，提示跑 bootstrap） |
| D4 | 导出 payload 形态 | 保持数组形态（含 schemaVersion？）——**裁决：导出仍为裸数组**（SPEC-025 前端 round-trip 剥离视图字段已依赖）；`schemaVersion` 经响应头/包络？——**裁决：导出 `{ schemaVersion, definitions: [...] }` 包络**（round-trip 前端适配剥离 schemaVersion） |
| D5 | 前端适配 | 导出下载解析 `{schemaVersion, definitions}` → 剥离视图字段 + schemaVersion → 上传 `{schemaVersion, definitions}`；导入兼容裸数组 / 旧包络 |
| D6 | 零结构变更 | 无迁移/模型/权限/事件/路由变更（复用 export/import 端点） |

## 3. 服务层（approval-definition-service）

### 3.1 exportDefinitions(query) 增强

```ts
// query: { codes?: string[]; businessType?: ApprovalBusinessType }（可选，缺省全量）
async exportDefinitions(query?: ExportDefinitionsQuery): Promise<DefinitionExportPayload> {
  this.authorization.requireAction(this.authorizationContext, 'approval.manage');
  assertExactKeys(query ?? {}, ['codes', 'businessType']);
  const where = {
    ...(query?.businessType && { businessType: normalizeAllowedValue(query.businessType, APPROVAL_BUSINESS_TYPES) }),
    ...(query?.codes && { code: { in: normalizeCodeList(query.codes) } }),
  };
  const rows = await this.prisma.approvalDefinition.findMany({ where, orderBy: [{ code: 'asc' }] });
  return { schemaVersion: DEFINITION_EXPORT_SCHEMA_VERSION, definitions: rows.map(projectApprovalDefinition) };
}
```

### 3.2 importDefinitions(input) 增强

```ts
// input: { schemaVersion?: number; definitions: [...] }
// 校验：schemaVersion === undefined || === 1（否则 400）；definitions ≤100；逐定义校验（既有）
// + 关联角色存在性校验（approverRule.roleCodes → prisma.role.count({ code, status:'ENABLED' })；缺失 → 400）
// 单事务全或无（既有）→ { imported, updated }（既有）+ 缺失角色清单（400 时返回）
```

## 4. 控制器 + 前端

- 控制器 `exportDefinitions`：parseExportQuery（codes/businessType，codes 逗号分隔解析）；`importDefinitions`：assertExactKeys +schemaVersion。
- 前端 `api/approval.ts`：exportDefinitions 类型 +query 参数；importDefinitions input +schemaVersion；导出下载解析 `{schemaVersion, definitions}` 包络。
- 前端 round-trip：下载 → 剥离视图字段（保留 schemaVersion）→ 上传。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | 增量导出 codes/businessType 筛选 / 缺省全量 / schemaVersion=1 / import 无 schemaVersion 兼容 / schemaVersion=2 → 400 / 关联角色缺失 → 400（含角色码）/ 角色存在通过 / 单事务回滚 |
| 控制器 | 导出 query 透传 / 导入 schemaVersion 校验 / codes 逗号解析 |
| 前端 | 导出解析包络 / 导入带 schemaVersion / round-trip 保留 schemaVersion |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 13 不变。后端测试 +N（~8）。前端测试 +2。

## 7. 范围边界（明确 OUT）

- 自动建角色（import 不 provision 角色——沿 bootstrap 供给纪律，缺失提示跑 bootstrap）。
- 跨版本 Definition 语义迁移（schemaVersion >1 的字段转换）——OUT（当前仅校验拒绝）。
- Definition 复制（基于现有新建副本）——另行。

## 8. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D6 | 见 §2 | 用户授权自主推进 |
