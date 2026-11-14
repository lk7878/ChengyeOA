# 需求 Spec 文档拆分迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/spec/CONVENTIONS.md` 元规范，把单一大需求文档 `律所闭环管理系统需求开发文档.md` 复制式拆分迁移为 `docs/spec/` 下的 13 份业务模块 spec + 7 份横切契约 spec + 1 份总纲 README + 1 份追溯矩阵 TRACE.md，并对已完成开发做最小影响登记。

**Architecture:** 纯文档迁移，零代码改动。源文档按章节精确切分（§8.1~8.13 → MOD-001~013，§9~13+§7 → FTN-001~007），每份 spec 从源文档复制对应内容、套用 CONVENTIONS 模板（加 frontmatter、补溯源标注、新增「现状」列），最后建立 TRACE.md 模块级追溯矩阵。源文档瘦身为 README 总纲，git 历史保留原文。

**Tech Stack:** Markdown 文档；frontmatter（YAML）；git 本地提交（不 push）。

**源文档路径**：`D:/2_test/16_ChengyeOA/律所闭环管理系统需求开发文档.md`（下文简称「源 PRD」）。

## Global Constraints

- **不修改任何代码**：本计划只创建/修改 `docs/spec/` 下的 Markdown 文档与源 PRD。
- **不回填已验收 SPEC、不重测已验收代码**：SPEC-001~008 已本地验收，对应模块 spec 只在 frontmatter `implements` 字段登记 SPEC 编号并标注已验收，不要求任何重测。
- **有代码无 SPEC 的业务模块标「待补 SPEC」**：lead/customer/contract/case 等已有代码的模块，现状列填「待补SPEC」（⚠️），绝不标「待重写」。
- **复制式迁移**：内容从源 PRD 复制，保持业务原文，不得擅自改写需求语义；只做结构调整（加 frontmatter、加现状列、补溯源）。
- **编号永不变更**：MOD-001~013、FTN-001~007 编号一旦写入即固定。
- **状态进 frontmatter 不进文件名**：文件名只含 `编号-slug.md`。
- **git 提交纪律**：本地仓库配置已存在（kuili <likui870708@gmail.com>）。仅提交 `docs/spec/` 与源 PRD 瘦身，**不 `git add -A`**——每次只 `git add` 本次任务明确产出的文件，绝不夹带仓库里其他 887 个未提交文件。
- **中文与英文 slug**：文件名用分配表（CONVENTIONS §3.1）的英文 slug；frontmatter `title` 和正文标题用中文。

## 源章节映射表（供所有迁移任务引用）

| Spec 文件 | 源 PRD 章节 | 源行号范围 |
|---|---|---|
| MOD-001-organization-permission | §8.1 | 465-494 |
| MOD-002-system-config-center | §8.2 | 495-531 |
| MOD-003-brand-acquisition | §8.3 | 532-544 |
| MOD-004-lead-crm | §8.4 | 545-565 |
| MOD-005-customer-master-data | §8.5 | 566-581 |
| MOD-006-contract-finance | §8.6 | 582-617 |
| MOD-007-professional-team-sop | §8.7 | 618-701 |
| MOD-008-case-delivery-qc | §8.8 | 702-725 |
| MOD-009-satisfaction-repurchase-referral | §8.9 | 726-738 |
| MOD-010-ai-recording-file | §8.10 | 739-787 |
| MOD-011-organization-hr | §8.11 | 788-810 |
| MOD-012-management-dashboard | §8.12 | 811-874 |
| MOD-013-automation-notification-approval-audit | §8.13 | 875-918 |
| FTN-001-data-model | §9 | 919-1023 |
| FTN-002-state-machine-dictionary | §10 | 1024-1058 |
| FTN-003-rbac-data-scope | §11 | 1059-1100 |
| FTN-004-api-transaction-consistency | §12 | 1101-1155 |
| FTN-005-event-driven-model | §7.2-7.5 | 261-395 |
| FTN-006-approval-task-notification | §7.6-7.7 | 396-438 |
| FTN-007-non-functional-requirements | §13 | 1156-1173 |

**模块现状判定依据**（填「现状」列用，依据源码 `apps/server/app/controller/` + `prisma/schema.prisma` 45 model）：

| MOD | 控制器 | model | 现状判定 | 已落地SPEC |
|---|---|---|---|---|
| MOD-001 | organization/role/permission/user | Organization/Role/Permission/UserRole/DataScope... | ✅ 已验收 | SPEC-002/003/004/005 |
| MOD-002 | — | 无 config/dynamic-field | ⬜ 待开发 | — |
| MOD-003 | channel | Channel | ⚠️ 有代码无SPEC | — |
| MOD-004 | lead | Lead/LeadFollow | ⚠️ 有代码无SPEC（SPEC-009已批准未提交） | SPEC-009(待) |
| MOD-005 | customer | Customer | ⚠️ 有代码无SPEC（SPEC-009已批准未提交） | SPEC-009(待) |
| MOD-006 | contract/payment | Contract/Payment | ⚠️ 有代码无SPEC | — |
| MOD-007 | professionalTeam | ProfessionalTeam | ⚠️ 有代码无SPEC（无SOP字段配置） | — |
| MOD-008 | case | Case/CaseTask/Communication | ⚠️ 有代码无SPEC | — |
| MOD-009 | — | 无 | ⬜ 待开发 | — |
| MOD-010 | — | 无 | ⬜ 待开发（有专项设计） | — |
| MOD-011 | employee/performance | Employee/Performance | ⚠️ 部分(SPEC-003人事主数据) | SPEC-003(人) |
| MOD-012 | dashboard | 聚合查询 | ⚠️ 有代码无SPEC | — |
| MOD-013 | approval/notification | Approval/Notification/OperationLog | ⚠️ 部分(SPEC-007审批) | SPEC-007(部) |

## File Structure

新建文件（共 24 份）：
- `docs/spec/README.md` — 总纲（产品定位/组织模型/主链路/范围边界/模块导航）
- `docs/spec/TRACE.md` — 追溯矩阵
- `docs/spec/modules/_template-module.md` — 模块模板
- `docs/spec/modules/MOD-001..013-*.md` — 13 份业务模块
- `docs/spec/foundations/_template-foundation.md` — foundation 模板
- `docs/spec/foundations/FTN-001..007-*.md` — 7 份横切契约

修改文件：
- `律所闭环管理系统需求开发文档.md` — 瘦身为指向 `docs/spec/` 的迁移声明（可选：保留全文但顶部加迁移声明；本计划采用「顶部加迁移声明 + 保留全文」低风险方案，见 Task 13）

---

### Task 1: 创建模块 spec 模板

**Files:**
- Create: `docs/spec/modules/_template-module.md`

**Interfaces:**
- Produces: 模板结构，Task 3~15 所有 MOD 文档套用此模板。

- [ ] **Step 1: 创建模板文件**

文件内容（严格对齐 CONVENTIONS §4.1）：

```markdown
---
id: MOD-NNN
title: <模块中文名>
source: PRD §8.x
status: draft
implements:
design_refs:
last_updated: YYYY-MM-DD
---

# MOD-NNN <模块中文名>

## 1. 需求概述

## 2. 功能清单
| 编号 | 功能 | 需求 | 现状 |
|---|---|---|---|

## 3. 业务规则

## 4. 数据对象

## 5. 状态机

## 6. 验收要求

## 7. 追溯
- 专项设计:
- 落地 SPEC:
- 主要代码:
- 测试:
```

在模板底部加一行注释说明「现状」取值映射：`<!-- 现状列取值：已实现(✅)/待开发(⬜)/待补SPEC(⚠️)/有设计无SPEC(📋)，与 TRACE.md 图例一一对应 -->`。

- [ ] **Step 2: 验证模板结构**

Run: `grep -c "^##" docs/spec/modules/_template-module.md`
Expected: `7`（7 个二级标题：需求概述/功能清单/业务规则/数据对象/状态机/验收要求/追溯）

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/_template-module.md
git commit -m "docs(spec): add module spec template"
```

---

### Task 2: 创建 foundation spec 模板

**Files:**
- Create: `docs/spec/foundations/_template-foundation.md`

**Interfaces:**
- Produces: foundation 模板结构，Task 16~22 所有 FTN 文档套用。

- [ ] **Step 1: 创建模板文件**

文件内容（严格对齐 CONVENTIONS §4.2，无功能清单，改为契约定义+被引用模块）：

```markdown
---
id: FTN-NNN
title: <契约中文名>
source: PRD §x
status: draft
implements:
design_refs:
last_updated: YYYY-MM-DD
---

# FTN-NNN <契约中文名>

## 1. 契约概述

## 2. 契约定义

## 3. 规则与边界

## 4. 被引用模块

## 5. 验收要求

## 6. 追溯
- 专项设计:
- 落地 SPEC:
- 主要代码:
- 测试:
```

- [ ] **Step 2: 验证模板结构**

Run: `grep -c "^##" docs/spec/foundations/_template-foundation.md`
Expected: `6`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/foundations/_template-foundation.md
git commit -m "docs(spec): add foundation spec template"
```

---

### Task 3: 迁移 MOD-001 组织权限模块

**Files:**
- Create: `docs/spec/modules/MOD-001-organization-permission.md`

**Interfaces:**
- Consumes: 模板（Task 1）；源 PRD §8.1（行 465-494）。
- Produces: `MOD-001` spec，TRACE.md（Task 23）将引用其现状登记。

- [ ] **Step 1: 复制源内容并套模板**

读源 PRD 行 465-494，把内容填入模板：
- frontmatter: `id: MOD-001`、`title: 组织权限模块`、`source: PRD §8.1`、`status: approved`、`implements: SPEC-002, SPEC-003, SPEC-004, SPEC-005`、`design_refs: [docs/专项设计/角色权限与数据范围设计.md, docs/专项设计/系统管理员与超级管理员权限设计.md]`、`last_updated: 2026-07-28`
- §1 需求概述：源「功能说明」段（465-470）
- §2 功能清单：源功能表（ORG-01~ORG-10）逐行迁入，**新增「现状」列**全部填 `已实现`
- §3 业务规则：源「规则」6 条（488-493）
- §4 数据对象：`Organization/Position/Employee/Role/Permission/DataScope/UserRole`，注明「字段定义见 FTN-001」
- §5 状态机：本模块无独立业务状态机，填「无（账号启停状态见 FTN-002）」
- §6 验收要求：从 §14（行 1174+）抽取与本模块相关条目（权限隔离、越权不泄露、权限可解释来自 §3.3.5/§3.3.6 及 §14）
- §7 追溯：专项设计见 design_refs；落地 SPEC-002/003/004/005；主要代码 `apps/server/app/controller/{organization,role,permission,user}.ts`；测试 `apps/server/test/` 下权限相关

- [ ] **Step 2: 验证 frontmatter 完整**

Run: `grep -E "^(id|title|source|status|implements|design_refs|last_updated):" docs/spec/modules/MOD-001-organization-permission.md`
Expected: 7 行全部命中，无占位符。

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-001-organization-permission.md
git commit -m "docs(spec): migrate MOD-001 organization permission from PRD §8.1"
```

---

### Task 4: 迁移 MOD-002 系统配置中心模块

**Files:**
- Create: `docs/spec/modules/MOD-002-system-config-center.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.2（行 495-531）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-002`、`title: 系统配置中心模块`、`source: PRD §8.2`、`status: draft`、`implements:` (留空)、`design_refs: [docs/专项设计/动态字段表格与模板配置设计.md]`、`last_updated: 2026-07-28`
- §2 功能清单：CFG-01~CFG-11 逐行迁入，新增「现状」列全部填 `待开发`
- §3 业务规则：源「配置边界」7 条 + 「审核与生效规则」6 条（513-530）全部迁入
- §4 数据对象：填「无（schema 无 config/dynamic-field model；待 SPEC 立项）」
- §7 追溯：专项设计见 design_refs；落地 SPEC「待立项」；主要代码「无」；测试「无」

- [ ] **Step 2: 验证无占位符、现状列填好**

Run: `grep -c "^| CFG-" docs/spec/modules/MOD-002-system-config-center.md`
Expected: `11`（CFG-01~11 共 11 行）

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-002-system-config-center.md
git commit -m "docs(spec): migrate MOD-002 system config center from PRD §8.2"
```

---

### Task 5: 迁移 MOD-003 品牌运营与获客模块

**Files:**
- Create: `docs/spec/modules/MOD-003-brand-acquisition.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.3（行 532-544）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-003`、`title: 品牌运营与获客模块`、`source: PRD §8.3`、`status: draft`、`implements:` (留空)、`design_refs:` (留空，无对应专项设计)、`last_updated: 2026-07-28`
- §2 功能清单：MKT-01~MKT-06 迁入。MKT-01 渠道管理「现状」填 `待补SPEC`（channel.ts+Channel model 已存在），其余 MKT-02~06 填 `待开发`
- §7 追溯：落地 SPEC「待立项」；主要代码 `apps/server/app/controller/channel.ts`（仅渠道）

- [ ] **Step 2: 验证**

Run: `grep -c "^| MKT-" docs/spec/modules/MOD-003-brand-acquisition.md`
Expected: `6`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-003-brand-acquisition.md
git commit -m "docs(spec): migrate MOD-003 brand acquisition from PRD §8.3"
```

---

### Task 6: 迁移 MOD-004 线索销转模块

**Files:**
- Create: `docs/spec/modules/MOD-004-lead-crm.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.4（行 545-565）。
- Produces: MOD-004 是 SPEC-009 的需求来源之一（见 memory spec-009-lead-crm-customer）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-004`、`title: 线索销转模块`、`source: PRD §8.4`、`status: draft`、`implements: SPEC-009`、`design_refs: [docs/专项设计/页面与接口清单.md]`、`last_updated: 2026-07-28`
- §2 功能清单：CRM-01~CRM-08 迁入，新增「现状」列。依据源码 lead.ts 有实质实现，全部填 `待补SPEC`（注意：SPEC-009 设计已批准但未提交，代码为原型实现，未经 SPEC 验收，故填「待补SPEC」而非「已实现」）
- §3 业务规则：源 3 条（560-564）
- §4 数据对象：`Lead/LeadFollow`，注明「SPEC-009 计划重构为 +LeadPoolRecord/Appointment，见 FTN-001」
- §7 追溯：落地 SPEC-009（设计已批准，待实施计划）；主要代码 `apps/server/app/controller/lead.ts`、model `Lead/LeadFollow`

- [ ] **Step 2: 验证**

Run: `grep -c "^| CRM-" docs/spec/modules/MOD-004-lead-crm.md`
Expected: `8`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-004-lead-crm.md
git commit -m "docs(spec): migrate MOD-004 lead crm from PRD §8.4"
```

---

### Task 7: 迁移 MOD-005 客户主数据模块

**Files:**
- Create: `docs/spec/modules/MOD-005-customer-master-data.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.5（行 566-581）。
- Produces: MOD-005 是 SPEC-009 的需求来源之一。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-005`、`title: 客户主数据模块`、`source: PRD §8.5`、`status: draft`、`implements: SPEC-009`、`design_refs: [docs/专项设计/页面与接口清单.md]`、`last_updated: 2026-07-28`
- §2 功能清单：CUS-01~CUS-05 迁入，全部「现状」填 `待补SPEC`（customer.ts 原型，SPEC-009 覆盖 CUS-01~02，CUS-03~05 下推）
- §3 业务规则：源 3 条（577-580）
- §4 数据对象：`Customer`，注明「SPEC-009 计划 +Contact，见 FTN-001」
- §7 追溯：落地 SPEC-009（CUS-01~02）；主要代码 `apps/server/app/controller/customer.ts`、model `Customer`

- [ ] **Step 2: 验证**

Run: `grep -c "^| CUS-" docs/spec/modules/MOD-005-customer-master-data.md`
Expected: `5`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-005-customer-master-data.md
git commit -m "docs(spec): migrate MOD-005 customer master data from PRD §8.5"
```

---

### Task 8: 迁移 MOD-006 合同财务模块

**Files:**
- Create: `docs/spec/modules/MOD-006-contract-finance.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.6（行 582-617）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-006`、`title: 合同财务模块`、`source: PRD §8.6`、`status: draft`、`implements:` (留空)、`design_refs:` (留空)、`last_updated: 2026-07-28`
- §1 需求概述：源「合同类型」4 类（585-592）+ 功能说明
- §2 功能清单：源功能表迁入（注意源 §8.6 有合同类型子节无显式编号表，按源文逐功能转表，新增「现状」列填 `待补SPEC`，contract.ts/payment.ts 已有原型实现）
- §3 业务规则：源「规则」
- §4 数据对象：`Contract/Payment`
- §7 追归：落地 SPEC「待立项」；主要代码 `apps/server/app/controller/{contract,payment}.ts`

- [ ] **Step 2: 验证**

Run: `grep -E "implements|落地 SPEC" docs/spec/modules/MOD-006-contract-finance.md`
Expected: `implements:` 后为空值占位行，追溯段标「待立项」。

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-006-contract-finance.md
git commit -m "docs(spec): migrate MOD-006 contract finance from PRD §8.6"
```

---

### Task 9: 迁移 MOD-007 专业团队与分析报告模块

**Files:**
- Create: `docs/spec/modules/MOD-007-professional-team-sop.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.7（行 618-701，最大模块 83 行）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-007`、`title: 专业团队与分析报告模块`、`source: PRD §8.7`、`status: draft`、`implements:` (留空，professionalTeam.ts 有团队主数据但无 SOP 字段配置)、`design_refs: [docs/专项设计/三大专业团队SOP系统字段清单.md]`、`last_updated: 2026-07-28`
- §1 需求概述：源「团队范围」
- §2 功能清单：源「医疗纠纷团队/执行团队/刑事辩护团队」三小节（630-701）逐项转表，新增「现状」列。团队主数据(`ProfessionalTeam`)填 `待补SPEC`，SOP 节点/字段配置填 `待开发`
- §3 业务规则：源各团队规则
- §4 数据对象：`ProfessionalTeam/ProfessionalTeamMember`
- §7 追溯：落地 SPEC「待立项」（团队主数据部分可参考 SPEC-003 余绪）；主要代码 `apps/server/app/controller/professionalTeam.ts`

- [ ] **Step 2: 验证**

Run: `grep -E "医疗纠纷|执行团队|刑事辩护" docs/spec/modules/MOD-007-professional-team-sop.md | wc -l`
Expected: `≥3`（三个团队都出现）

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-007-professional-team-sop.md
git commit -m "docs(spec): migrate MOD-007 professional team SOP from PRD §8.7"
```

---

### Task 10: 迁移 MOD-008 案件交付与质控模块

**Files:**
- Create: `docs/spec/modules/MOD-008-case-delivery-qc.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.8（行 702-725）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-008`、`title: 案件交付与质量控制模块`、`source: PRD §8.8`、`status: draft`、`implements:` (留空)、`design_refs: [docs/专项设计/三大专业团队SOP系统字段清单.md]`、`last_updated: 2026-07-28`
- §2 功能清单：源功能迁入，现状填 `待补SPEC`（case.ts 原型）
- §3 业务规则：源「质量控制规则」
- §4 数据对象：`Case/CaseTask/Communication`
- §7 追溯：落地 SPEC「待立项」；主要代码 `apps/server/app/controller/case.ts`

- [ ] **Step 2: 验证**

Run: `grep -c "^##" docs/spec/modules/MOD-008-case-delivery-qc.md`
Expected: `7`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-008-case-delivery-qc.md
git commit -m "docs(spec): migrate MOD-008 case delivery QC from PRD §8.8"
```

---

### Task 11: 迁移 MOD-009 满意度、复购与转介绍模块

**Files:**
- Create: `docs/spec/modules/MOD-009-satisfaction-repurchase-referral.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.9（行 726-738，小模块 12 行）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-009`、`title: 满意度、复购与转介绍模块`、`source: PRD §8.9`、`status: draft`、`implements:` (留空)、`design_refs:` (留空)、`last_updated: 2026-07-28`
- §2 功能清单：源迁入，现状全部 `待开发`（无代码）
- §7 追溯：落地 SPEC「待立项」；主要代码「无」

- [ ] **Step 2: 验证无占位符**

Run: `grep -E "TBD|TODO|<.*>" docs/spec/modules/MOD-009-satisfaction-repurchase-referral.md`
Expected: 无命中（frontmatter 的 design_refs 空值不算占位符）

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-009-satisfaction-repurchase-referral.md
git commit -m "docs(spec): migrate MOD-009 satisfaction referral from PRD §8.9"
```

---

### Task 12: 迁移 MOD-010 AI、录音与文件模块

**Files:**
- Create: `docs/spec/modules/MOD-010-ai-recording-file.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.10（行 739-787）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-010`、`title: AI、录音与文件模块`、`source: PRD §8.10`、`status: draft`、`implements:` (留空)、`design_refs: [docs/专项设计/文件录音AI任务设计.md]`、`last_updated: 2026-07-28`
- §1 需求概述：源「录音能力/AI 供应商/文件能力」三小节
- §2 功能清单：源功能迁入，现状 `待开发`（有专项设计无代码）
- §7 追溯：落地 SPEC「待立项」；主要代码「无」

- [ ] **Step 2: 验证**

Run: `grep -E "录音|AI 供应商|文件" docs/spec/modules/MOD-010-ai-recording-file.md | wc -l`
Expected: `≥3`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-010-ai-recording-file.md
git commit -m "docs(spec): migrate MOD-010 AI recording file from PRD §8.10"
```

---

### Task 13: 迁移 MOD-011 组织人事模块

**Files:**
- Create: `docs/spec/modules/MOD-011-organization-hr.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.11（行 788-810）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-011`、`title: 组织人事模块`、`source: PRD §8.11`、`status: draft`、`implements: SPEC-003`（SPEC-003 覆盖员工主数据部分，考勤/请假/培训/绩效未覆盖）、`design_refs: [docs/专项设计/数据库核心表设计草案.md]`、`last_updated: 2026-07-28`
- §2 功能清单：源迁入。员工/岗位部分填 `已实现`（SPEC-003），考勤/请假/培训/绩效填 `待补SPEC`（performance.ts 有原型但无 SPEC）
- §3 业务规则：源「绩效模型」
- §4 数据对象：`Employee/Performance`
- §7 追溯：落地 SPEC-003（员工主数据部分）；主要代码 `apps/server/app/controller/{employee,performance}.ts`

- [ ] **Step 2: 验证**

Run: `grep "implements: SPEC-003" docs/spec/modules/MOD-011-organization-hr.md`
Expected: 命中 1 行

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-011-organization-hr.md
git commit -m "docs(spec): migrate MOD-011 organization HR from PRD §8.11"
```

---

### Task 14: 迁移 MOD-012 管理驾驶舱模块

**Files:**
- Create: `docs/spec/modules/MOD-012-management-dashboard.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.12（行 811-874）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-012`、`title: 管理驾驶舱模块`、`source: PRD §8.12`、`status: draft`、`implements:` (留空)、`design_refs:` (留空)、`last_updated: 2026-07-28`
- §2 功能清单：源「经营指标/团队指标/财务指标/交付与质控指标/品牌与转介绍指标」五类迁入，现状 `待补SPEC`（dashboard.ts 有聚合查询原型）
- §7 追溯：落地 SPEC「待立项」；主要代码 `apps/server/app/controller/dashboard.ts`

- [ ] **Step 2: 验证**

Run: `grep -E "经营指标|团队指标|财务指标" docs/spec/modules/MOD-012-management-dashboard.md | wc -l`
Expected: `≥3`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-012-management-dashboard.md
git commit -m "docs(spec): migrate MOD-012 management dashboard from PRD §8.12"
```

---

### Task 15: 迁移 MOD-013 自动化、通知、审批与审计模块

**Files:**
- Create: `docs/spec/modules/MOD-013-automation-notification-approval-audit.md`

**Interfaces:**
- Consumes: 模板；源 PRD §8.13（行 875-918）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: MOD-013`、`title: 自动化、通知、审批与审计模块`、`source: PRD §8.13`、`status: draft`、`implements: SPEC-007`（SPEC-007 覆盖审批实例/通知/outbox 部分，自动化规则引擎未覆盖）、`design_refs: [docs/专项设计/审计日志与自动化规则设计.md, docs/专项设计/审批实例任务与消息回调设计.md]`、`last_updated: 2026-07-28`
- §2 功能清单：源「自动化规则/审计要求」迁入。审批/通知/outbox 部分填 `已实现`（SPEC-007），自动化规则引擎填 `待开发`
- §7 追溯：落地 SPEC-007（审批/通知部分）；主要代码 `apps/server/app/controller/{approval,notification}.ts`、model `Approval/Notification/OperationLog/EventLog`

- [ ] **Step 2: 验证**

Run: `grep "implements: SPEC-007" docs/spec/modules/MOD-013-automation-notification-approval-audit.md`
Expected: 命中 1 行

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/modules/MOD-013-automation-notification-approval-audit.md
git commit -m "docs(spec): migrate MOD-013 automation audit from PRD §8.13"
```

---

### Task 16: 迁移 FTN-001 数据模型契约

**Files:**
- Create: `docs/spec/foundations/FTN-001-data-model.md`

**Interfaces:**
- Consumes: foundation 模板（Task 2）；源 PRD §9（行 919-1023）。
- Produces: 数据模型契约，所有 MOD 的「数据对象」段引用本契约。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: FTN-001`、`title: 数据模型`、`source: PRD §9`、`status: approved`、`implements: SPEC-001, SPEC-003`、`design_refs: [docs/专项设计/数据库核心表设计草案.md]`、`last_updated: 2026-07-28`
- §1 契约概述：源 §9.1 核心对象关系
- §2 契约定义：源 §9.2 建议核心表。注明「物理 schema 以 Prisma `apps/server/prisma/schema.prisma` 45 model 为准，本契约为需求侧对象关系定义」
- §4 被引用模块：列出所有 MOD-001~013（数据对象均引用本契约）
- §6 追溯：落地 SPEC-001/003；主要代码 `prisma/schema.prisma`

- [ ] **Step 2: 验证**

Run: `grep -c "^##" docs/spec/foundations/FTN-001-data-model.md`
Expected: `6`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/foundations/FTN-001-data-model.md
git commit -m "docs(spec): migrate FTN-001 data model from PRD §9"
```

---

### Task 17: 迁移 FTN-002 状态机与业务字典契约

**Files:**
- Create: `docs/spec/foundations/FTN-002-state-machine-dictionary.md`

**Interfaces:**
- Consumes: foundation 模板；源 PRD §10（行 1024-1058）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: FTN-002`、`title: 状态机与业务字典`、`source: PRD §10`、`status: draft`、`implements:` (留空，无独立状态机 SPEC，散落在各业务 SPEC 内)、`design_refs: [docs/专项设计/状态机与业务字典设计.md]`、`last_updated: 2026-07-28`
- §2 契约定义：源 §10 状态机要求
- §4 被引用模块：MOD-004/006/008（线索/合同/案件有状态流转）

- [ ] **Step 2: 验证**

Run: `grep -c "^##" docs/spec/foundations/FTN-002-state-machine-dictionary.md`
Expected: `6`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/foundations/FTN-002-state-machine-dictionary.md
git commit -m "docs(spec): migrate FTN-002 state machine dictionary from PRD §10"
```

---

### Task 18: 迁移 FTN-003 RBAC 与数据范围契约

**Files:**
- Create: `docs/spec/foundations/FTN-003-rbac-data-scope.md`

**Interfaces:**
- Consumes: foundation 模板；源 PRD §11（行 1059-1100）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: FTN-003`、`title: RBAC 与数据范围`、`source: PRD §11`、`status: approved`、`implements: SPEC-004`、`design_refs: [docs/专项设计/角色权限与数据范围设计.md]`、`last_updated: 2026-07-28`
- §2 契约定义：源 §11 权限与数据范围 + §11.1 数据分级与处理规则
- §4 被引用模块：所有 MOD（所有业务列表接入数据范围过滤）

- [ ] **Step 2: 验证**

Run: `grep "implements: SPEC-004" docs/spec/foundations/FTN-003-rbac-data-scope.md`
Expected: 命中

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/foundations/FTN-003-rbac-data-scope.md
git commit -m "docs(spec): migrate FTN-003 RBAC data scope from PRD §11"
```

---

### Task 19: 迁移 FTN-004 API、事务与一致性契约

**Files:**
- Create: `docs/spec/foundations/FTN-004-api-transaction-consistency.md`

**Interfaces:**
- Consumes: foundation 模板；源 PRD §12（行 1101-1155）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: FTN-004`、`title: API、事务与一致性`、`source: PRD §12`、`status: approved`、`implements:` (散落在各 SPEC)、`design_refs: [docs/专项设计/API规范错误码与事务边界设计.md]`、`last_updated: 2026-07-28`
- §2 契约定义：源 §12.1 API 规范 + §12.2 事务边界 + §12.3 一致性策略
- §4 被引用模块：所有 MOD

- [ ] **Step 2: 验证**

Run: `grep -c "^##" docs/spec/foundations/FTN-004-api-transaction-consistency.md`
Expected: `6`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/foundations/FTN-004-api-transaction-consistency.md
git commit -m "docs(spec): migrate FTN-004 API transaction consistency from PRD §12"
```

---

### Task 20: 迁移 FTN-005 事件驱动模型契约

**Files:**
- Create: `docs/spec/foundations/FTN-005-event-driven-model.md`

**Interfaces:**
- Consumes: foundation 模板；源 PRD §7.2-7.5（行 261-395）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: FTN-005`、`title: 事件驱动模型`、`source: PRD §7.2-7.5`、`status: approved`、`implements: SPEC-007, SPEC-008`、`design_refs: [docs/专项设计/数据流转事件中心设计.md]`、`last_updated: 2026-07-28`
- §1 契约概述：源 §7.1 资源对象模型 + §7.2 事件驱动模型
- §2 契约定义：源 §7.3 事件类型清单 + §7.4 订阅投递重试 + §7.5 同步回调
- §4 被引用模块：MOD-013（事件中心核心）+ 其他需发事件的 MOD

- [ ] **Step 2: 验证**

Run: `grep "implements: SPEC-007, SPEC-008" docs/spec/foundations/FTN-005-event-driven-model.md`
Expected: 命中

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/foundations/FTN-005-event-driven-model.md
git commit -m "docs(spec): migrate FTN-005 event driven model from PRD §7.2-7.5"
```

---

### Task 21: 迁移 FTN-006 审批、任务与消息通知契约

**Files:**
- Create: `docs/spec/foundations/FTN-006-approval-task-notification.md`

**Interfaces:**
- Consumes: foundation 模板；源 PRD §7.6-7.7（行 396-438）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: FTN-006`、`title: 审批、任务与消息通知`、`source: PRD §7.6-7.7`、`status: approved`、`implements: SPEC-007`（审批实例与通知部分）、`design_refs: [docs/专项设计/审批实例任务与消息回调设计.md]`、`last_updated: 2026-07-28`
- §2 契约定义：源 §7.6 审批实例与任务模型 + §7.7 消息通知与任务分发
- §4 被引用模块：MOD-002（配置审核）/MOD-005（客户合并审批）/MOD-013

- [ ] **Step 2: 验证**

Run: `grep -c "^##" docs/spec/foundations/FTN-006-approval-task-notification.md`
Expected: `6`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/foundations/FTN-006-approval-task-notification.md
git commit -m "docs(spec): migrate FTN-006 approval task notification from PRD §7.6-7.7"
```

---

### Task 22: 迁移 FTN-007 非功能需求契约

**Files:**
- Create: `docs/spec/foundations/FTN-007-non-functional-requirements.md`

**Interfaces:**
- Consumes: foundation 模板；源 PRD §13（行 1156-1173）。

- [ ] **Step 1: 复制源内容并套模板**

- frontmatter: `id: FTN-007`、`title: 非功能需求`、`source: PRD §13`、`status: draft`、`implements: SEC-SPEC-001, SPEC-006`（安全/身份相关）、`design_refs:` (留空)、`last_updated: 2026-07-28`
- §2 契约定义：源 §13 非功能需求全部条目
- §4 被引用模块：所有 MOD（非功能横切全局）

- [ ] **Step 2: 验证**

Run: `grep -c "^##" docs/spec/foundations/FTN-007-non-functional-requirements.md`
Expected: `6`

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/foundations/FTN-007-non-functional-requirements.md
git commit -m "docs(spec): migrate FTN-007 non-functional requirements from PRD §13"
```

---

### Task 23: 建立 TRACE.md 追溯矩阵

**Files:**
- Create: `docs/spec/TRACE.md`

**Interfaces:**
- Consumes: Task 3~15（13 MOD 现状）+ Task 16~22（7 FTN 现状）。

- [ ] **Step 1: 建立矩阵**

文件内容（严格对齐 CONVENTIONS §5，模块级粗粒度）。业务模块表 13 行、横切契约表 7 行，「现状」列对齐各 spec frontmatter `implements` 字段确定。图例：✅已验收 / ⚠️有代码无SPEC / ⬜待开发 / 📋有设计无SPEC。

业务模块表填入（编号|模块|专项设计|已落地SPEC|现状），逐行依据 Task 3~15 的 frontmatter 落实：
- MOD-001 组织权限 | 角色权限/系统管理员权限设计 | SPEC-002/003/004/005 | ✅已验收
- MOD-002 系统配置中心 | 动态字段表格与模板配置 | — | ⬜待开发
- MOD-003 品牌获客 | 页面与接口清单(渠道部分) | — | ⚠️有代码无SPEC
- MOD-004 线索销转 | 页面与接口清单 | SPEC-009(待实施) | ⚠️有代码无SPEC
- MOD-005 客户主数据 | 页面与接口清单 | SPEC-009(待实施) | ⚠️有代码无SPEC
- MOD-006 合同财务 | — | — | ⚠️有代码无SPEC
- MOD-007 专业团队SOP | 三大团队SOP字段清单 | — | ⚠️有代码无SPEC
- MOD-008 案件交付质控 | 三大团队SOP字段清单 | — | ⚠️有代码无SPEC
- MOD-009 满意度转介绍 | — | — | ⬜待开发
- MOD-010 AI录音文件 | 文件录音AI任务设计 | — | 📋有设计无SPEC
- MOD-011 组织人事 | 数据库核心表设计 | SPEC-003(部分) | ⚠️有代码无SPEC
- MOD-012 驾驶舱 | — | — | ⚠️有代码无SPEC
- MOD-013 自动化审批审计 | 审计自动化/审批消息回调 | SPEC-007(部分) | ⚠️有代码无SPEC

横切契约表填入：
- FTN-001 数据模型 | 数据库核心表设计草案 | SPEC-001/003 | ✅已验收
- FTN-002 状态机字典 | 状态机与业务字典设计 | — | ⬜待开发(底座45model已建)
- FTN-003 RBAC数据范围 | 角色权限与数据范围设计 | SPEC-004 | ✅已验收
- FTN-004 API事务一致性 | API规范错误码事务边界 | 各SPEC散落 | ✅已验收
- FTN-005 事件驱动模型 | 数据流转事件中心设计 | SPEC-007/008 | ✅已验收
- FTN-006 审批任务通知 | 审批实例任务消息回调 | SPEC-007(部分) | ⚠️有代码无SPEC
- FTN-007 非功能需求 | — | SEC-SPEC-001/006 | ⚠️有代码无SPEC

顶部加说明：「粒度：模块级。功能点级追溯见各 MOD 文档内现状表。」

- [ ] **Step 2: 验证行数**

Run: `grep -cE "^\| (MOD|FTN)-" docs/spec/TRACE.md`
Expected: `20`（13 MOD + 7 FTN）

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/TRACE.md
git commit -m "docs(spec): establish module-level TRACE matrix"
```

---

### Task 24: 创建 README 总纲

**Files:**
- Create: `docs/spec/README.md`

**Interfaces:**
- Consumes: 源 PRD §1-7（产品定位/组织模型/主链路/范围边界）+ 全部已建 spec 文件的导航。

- [ ] **Step 1: 创建总纲**

总纲内容结构：
- 头部 frontmatter：`title: 承业OA需求Spec总纲`、`type: index`、`status: approved`、`last_updated: 2026-07-28`
- 顶部声明：「权威需求源已迁移至本目录。原 `律所闭环管理系统需求开发文档.md` 保留全文于仓库根，本 README 仅保留全局视图与导航。规范见 [CONVENTIONS.md](CONVENTIONS.md)。」
- §1 产品定位：从源 PRD §2 复制（行 26-49 闭环 mermaid）
- §2 组织模型：从源 PRD §5.1 复制组织树 mermaid（行 126-159）
- §3 关键角色：从源 PRD §5.2 复制角色表（行 161-181）
- §4 主链路闭环：引用 §2 的闭环图，一句话说明
- §5 范围边界：从源 PRD §4.1/§4.2 复制纳入/暂不纳入（行 88-122）
- §6 模块导航：表格列出 MOD-001~013 + FTN-001~007，每行链接到对应文件，含一句用途
- §7 与下游文档关系：四层拓扑说明（引用 CONVENTIONS §1 的表）

- [ ] **Step 2: 验证导航链接完整**

Run: `grep -cE "MOD-0[0-9][0-9]-|FTN-00[0-9]-" docs/spec/README.md`
Expected: `≥20`（13 个 MOD 链接 + 7 个 FTN 链接）

- [ ] **Step 3: 验证链接可达**

Run: `cd docs/spec && for f in $(grep -oE "(MOD|FTN)-[0-9]{3}-[a-z-]+\.md" README.md | sort -u); do test -f modules/$f || test -f foundations/$f || echo "MISSING: $f"; done`
Expected: 无 MISSING 输出

- [ ] **Step 4: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add docs/spec/README.md
git commit -m "docs(spec): add README master index"
```

---

### Task 25: 源 PRD 顶部加迁移声明

**Files:**
- Modify: `律所闭环管理系统需求开发文档.md`（仅顶部插入声明，保留全文）

**Interfaces:**
- Consumes: Task 24 README 已建。

- [ ] **Step 1: 在源 PRD 顶部 frontmatter 后插入迁移声明**

在源 PRD 第 1 行 `# 承业律师事务所综合管理 OA 系统 PRD` 标题之后、第 3 行 `> 文档版本` 之前，插入一段引用块：

```markdown
> **迁移声明（2026-07-28）**：本文件的需求明细已按 `docs/spec/CONVENTIONS.md` 规范拆分迁移至 `docs/spec/`（业务模块 `modules/MOD-001~013`、横切契约 `foundations/FTN-001~007`、追溯矩阵 `TRACE.md`、总纲 `README.md`）。本文件保留全文作为历史基线，后续需求变更以 `docs/spec/` 为权威来源，不再维护本文件的明细内容。
```

不删除、不改动原文件任何其他内容。

- [ ] **Step 2: 验证声明已插入且原文未损**

Run: `grep -c "迁移声明（2026-07-28）" "律所闭环管理系统需求开发文档.md"`
Expected: `1`

Run: `grep -c "^## 8\. 功能需求" "律所闭环管理系统需求开发文档.md"`
Expected: `1`（原文 §8 仍在）

- [ ] **Step 3: 提交**

```bash
cd "D:/2_test/16_ChengyeOA"
git add "律所闭环管理系统需求开发文档.md"
git commit -m "docs(prd): add migration notice pointing to docs/spec/"
```

---

### Task 26: 全局一致性验证

**Files:**
- 无新建/修改，仅验证。

- [ ] **Step 1: 验证文件数量**

Run: `ls docs/spec/modules/MOD-*.md | wc -l && ls docs/spec/foundations/FTN-*.md | wc -l`
Expected: `13` 和 `7`

- [ ] **Step 2: 验证所有 spec 含完整 frontmatter**

Run: `for f in docs/spec/{modules,foundations}/*.md; do grep -qE "^id: (MOD|FTN)-[0-9]{3}$" "$f" || echo "BAD id: $f"; grep -q "^status:" "$f" || echo "BAD status: $f"; done`
Expected: 无 BAD 输出

- [ ] **Step 3: 验证无占位符泄漏**

Run: `grep -rnE "TBD|TODO|<模块|<契约|YYYY-MM-DD" docs/spec/{modules,foundations}/*.md | grep -v "_template"`
Expected: 无命中（模板文件除外）

- [ ] **Step 4: 验证 TRACE.md 与各 spec implements 一致**

抽查关键一致点：
Run: `grep "implements: SPEC-004" docs/spec/modules/MOD-001-organization-permission.md docs/spec/foundations/FTN-003-rbac-data-scope.md`
Expected: 两个文件都命中（MOD-001 和 FTN-003 都 implements SPEC-004，与 TRACE 一致）

- [ ] **Step 5: 验证 git 干净**

Run: `git status --short docs/spec/ "律所闭环管理系统需求开发文档.md"`
Expected: 空输出（全部已提交）

- [ ] **Step 6: 不提交**

本任务是只读验证，无产出文件，不需要 commit。若 Step 1~5 全通过，宣告迁移完成。

---

## Self-Review

**1. Spec coverage**：CONVENTIONS §2 目录结构要求的 24 份文件（README/TRACE/13MOD/7FTN/2模板）→ Task 1~24 全覆盖。§3 命名 → 各 Task 文件名遵循。§4 模板 → Task 1/2。§5 TRACE.md → Task 23。§6 演进纪律（最小影响）→ Global Constraints + 各 Task 现状列判定表。§7 边界 → Task 24 README §7。无遗漏。

**2. Placeholder scan**：扫一遍——每个 Task 的 frontmatter 字段值、源行号、现状判定、提交命令都已写实，无 TBD/TODO。验证命令含具体 expected 数值。通过。

**3. Type/命名 consistency**：检查 slug 一致性——Task 3 文件名 `MOD-001-organization-permission` 与 CONVENTIONS §3.1 表 `organization-permission` 一致；逐个核对 Task 3~22 的 slug 与 CONVENTIONS §3.1 分配表全部吻合。frontmatter `implements` 值与 Task 23 TRACE 表条目逐行核对一致（如 MOD-001 implements SPEC-002/003/004/005 ↔ TRACE「已落地SPEC SPEC-002/003/004/005」）。通过。

**4. 一个修正**：Task 13（MOD-011）原文写「implements: SPEC-003」并标「员工主数据部分」——但 SPEC-003 覆盖的是组织+人员主数据，考勤/请假/培训/绩效不在内，frontmatter `implements: SPEC-003` 会让人误以为整个 MOD-011 已落地。已在 Task 13 的 §2 现状列和 §7 追溯段注明「部分」，frontmatter 保持 `SPEC-003` 但 TRACE 行标注「SPEC-003(部分)」，符合「最小影响、如实登记」原则。无需修改计划。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-28-spec-document-migration-implementation.md`. Two execution options:

**1. Subagent-Driven（推荐）** — 每个 Task 派一个全新 subagent 执行，Task 间我做 review 检查点，迭代快、每份 spec 独立质量可控。

**2. Inline Execution** — 在当前会话用 executing-plans 批量执行，带检查点 review。

哪种方式？
