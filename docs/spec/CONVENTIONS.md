---
id: CONVENTIONS
title: 需求 Spec 管理规范
type: meta-spec
status: approved
created: 2026-07-28
last_updated: 2026-07-28
---

# 需求 Spec 管理规范

> 本文件是 `docs/spec/` 体系的元规范（「宪法」），定义需求 spec 的组织方式、命名规则、文档模板、追溯关系与演进纪律。它本身不是业务需求 spec，而是所有业务 spec 应遵循的规则。

## 1. 定位与目标

`docs/spec/` 是**需求层**，只回答 what——每个业务模块和横切契约要做什么。它位于已有的三层文档之上，共同构成项目的四层文档体系：

| 层 | 目录 | 职责 | 状态 |
|---|---|---|---|
| 需求 | `docs/spec/` | what — 模块/契约要做什么 | 本规范管辖 |
| 设计契约 | `docs/专项设计/` | how — 技术契约（表结构/接口/状态机编码/事件名） | 保持不动 |
| 工程规格 | `docs/superpowers/specs/` | SPEC-0xx 工程执行规格（设计+实施规格） | 保持不动 |
| 实施 | `docs/superpowers/plans/` + 源码 | 实施计划与代码落地、验收 | 保持不动 |

**目标**：把单一大需求文档拆分为可独立演进、可追溯、可对应单个 SPEC 闭环的模块化需求 spec，支撑 spec 驱动开发与二次开发管理。

**非目标**：不替代专项设计的技术契约职责；不重写已验收的工程 SPEC；不规定实现细节。

## 2. 目录结构

```
docs/spec/
├── CONVENTIONS.md              # 本文件：元规范
├── README.md                   # 总纲：产品定位/组织模型/主链路闭环/范围边界/模块导航
├── modules/                    # 业务模块需求 spec（13 份）
│   ├── MOD-001-organization-permission.md
│   ├── MOD-002-system-config-center.md
│   ├── MOD-003-brand-acquisition.md
│   ├── MOD-004-lead-crm.md
│   ├── MOD-005-customer-master-data.md
│   ├── MOD-006-contract-finance.md
│   ├── MOD-007-professional-team-sop.md
│   ├── MOD-008-case-delivery-qc.md
│   ├── MOD-009-satisfaction-repurchase-referral.md
│   ├── MOD-010-ai-recording-file.md
│   ├── MOD-011-organization-hr.md
│   ├── MOD-012-management-dashboard.md
│   ├── MOD-013-automation-notification-approval-audit.md
│   └── _template-module.md     # 模块 spec 模板
├── foundations/                # 横切契约 spec（7 份，所有模块共用）
│   ├── FTN-001-data-model.md
│   ├── FTN-002-state-machine-dictionary.md
│   ├── FTN-003-rbac-data-scope.md
│   ├── FTN-004-api-transaction-consistency.md
│   ├── FTN-005-event-driven-model.md
│   ├── FTN-006-approval-task-notification.md
│   ├── FTN-007-non-functional-requirements.md
│   └── _template-foundation.md # foundation spec 模板
└── TRACE.md                    # 追溯矩阵（模块级粗粒度）
```

## 3. 命名规范

- **格式**：`MOD-NNN-<english-slug>.md` / `FTN-NNN-<english-slug>.md`
- **编号**：两位补零（`MOD-001` 而非 `MOD-1`）。编号一旦分配**永不变更**，即使模块被弃用，编号也不回收复用。
- **slug**：全小写、连字符分隔、英文，与 `docs/superpowers/specs/` 风格对齐，便于跨平台检索与排序。
- **状态**：用 frontmatter 的 `status` 字段（`draft | approved | superseded`），**不进文件名**。状态变更不触发重命名，避免断链。
- **不沿用 PRD 章节号**：模块从 `MOD-001` 重编，但每个文档 frontmatter 用 `source: PRD §8.x` 字段溯源到原 PRD 章节。
- **模板文件**：以 `_` 开头（`_template-module.md`），排序时排在模块列表底部，与正式 spec 区分。

### 3.1 编号分配表

业务模块（按原 PRD §8 顺序，便于溯源）：

| 编号 | 模块 | 原PRD章节 | slug |
|---|---|---|---|
| MOD-001 | 组织权限 | §8.1 | organization-permission |
| MOD-002 | 系统配置中心 | §8.2 | system-config-center |
| MOD-003 | 品牌运营与获客 | §8.3 | brand-acquisition |
| MOD-004 | 线索销转 | §8.4 | lead-crm |
| MOD-005 | 客户主数据 | §8.5 | customer-master-data |
| MOD-006 | 合同财务 | §8.6 | contract-finance |
| MOD-007 | 专业团队与分析报告 | §8.7 | professional-team-sop |
| MOD-008 | 案件交付与质控 | §8.8 | case-delivery-qc |
| MOD-009 | 满意度、复购与转介绍 | §8.9 | satisfaction-repurchase-referral |
| MOD-010 | AI、录音与文件 | §8.10 | ai-recording-file |
| MOD-011 | 组织人事 | §8.11 | organization-hr |
| MOD-012 | 管理驾驶舱 | §8.12 | management-dashboard |
| MOD-013 | 自动化、通知、审批与审计 | §8.13 | automation-notification-approval-audit |

横切契约（按原 PRD §7/§9-13 自然边界）：

| 编号 | 契约 | 原PRD章节 | slug |
|---|---|---|---|
| FTN-001 | 数据模型 | §9 | data-model |
| FTN-002 | 状态机与业务字典 | §10 | state-machine-dictionary |
| FTN-003 | RBAC 与数据范围 | §11 | rbac-data-scope |
| FTN-004 | API、事务与一致性 | §12 | api-transaction-consistency |
| FTN-005 | 事件驱动模型 | §7.2-7.5 | event-driven-model |
| FTN-006 | 审批、任务与消息通知 | §7.6-7.7 | approval-task-notification |
| FTN-007 | 非功能需求 | §13 | non-functional-requirements |

## 4. 文档模板

### 4.1 模块 spec 模板（`modules/_template-module.md`）

```markdown
---
id: MOD-NNN
title: <模块中文名>
source: PRD §8.x
status: draft            # draft | approved | superseded
implements:              # 已落地的 SPEC 编号，无则留空
design_refs:             # 对应的专项设计文件路径列表
last_updated: YYYY-MM-DD
---

# MOD-NNN <模块中文名>

## 1. 需求概述
（从原 PRD 摘录，保持业务语言，描述模块要解决什么经营问题）

## 2. 功能清单
| 编号 | 功能 | 需求 | 现状 |
|---|---|---|---|
| XXX-01 | ... | ... | 已实现/待开发/待补SPEC |
（原 PRD 表格逐行迁入，新增「现状」列标注实现状态。「现状」取值与 TRACE.md 图例一一对应：已实现=✅、待开发=⬜、待补SPEC=⚠️、有设计无SPEC=📋）

## 3. 业务规则
（原 PRD 该模块「规则」小节，逐条列出）

## 4. 数据对象
（本模块涉及的核心数据对象，引用 FTN-001，不重复定义字段细节）

## 5. 状态机
（若涉及，引用 FTN-002，列出本模块的状态与转换）

## 6. 验收要求
（从原 PRD §14 抽取与本模块相关的验收点）

## 7. 追溯
- 专项设计: <路径或「无」>
- 落地 SPEC: <SPEC-0xx 或「待立项」>
- 主要代码: <文件路径或「无」>
- 测试: <文件路径或「无」>
```

### 4.2 Foundation spec 模板（`foundations/_template-foundation.md`）

与模块模板结构相似，但：
- 无「功能清单 + 现状」表，改为「契约定义」（编码/约束/规则）。
- 增加「被引用模块」清单（哪些 MOD 依赖本契约）。

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
## 2. 契约定义（编码表/约束/业务字典等）
## 3. 规则与边界
## 4. 被引用模块（哪些 MOD 依赖本契约）
## 5. 验收要求
## 6. 追溯
```

## 5. 追溯机制（TRACE.md）

`TRACE.md` 是模块级粗粒度追溯矩阵，提供项目全局视图，是 spec 驱动管理的入口。

- **粒度**：模块级（每个 MOD/FTN 一行），不追到单个功能点（功能点级追溯在各 MOD 文档内的「现状」列）。
- **列**：编号 | 名称 | 专项设计 | 已落地SPEC | 现状。
- **现状图例**：✅ 已验收 | ⚠️ 有代码无SPEC（待补） | ⬜ 待开发 | 📋 有专项设计无SPEC。
- **维护纪律**：每次 SPEC 立项/验收、每次新模块进入实现，更新对应行。TRACE.md 是轻量概览，详情下沉到各 spec 文档。

`TRACE.md` 与各文档 frontmatter 的 `implements` 字段配合：`grep "implements: SPEC-" docs/spec/**/*.md` 可快速统计哪些需求已由哪个 SPEC 落地。

## 6. 演进纪律

### 6.1 向后：最小影响已完成的开发

1. **已完成的工作是事实源，spec 层只追溯不动它。** SPEC-001~008（底座：组织权限/配置治理/身份安全/事件中心/工程基线）已通过本地验收，对应 MOD/FTN 文档只在文档头标注「已由 SPEC-0xx 落地」并链接 closeout，不回填 SPEC、不要求重测。
2. **有代码无 SPEC 的业务模块按「待补 SPEC」对待，不按「待重写」对待。** 已有实质代码的 lead/customer/contract/case 等模块，spec 文档如实记录需求 + 标注「现状有实现、尚未走 SPEC 闭环」。未来这些模块获得新 SPEC（如 SPEC-009）时引用对应 MOD 文档作需求输入，现有代码通过新 SPEC 验收来确认，而非推倒重写。
3. **未来 plan 调整只向前看。** 已 closeout 的 plan 不改；新 SPEC 的 plan 在「需求来源」一栏引用 `docs/spec/MOD-NNN` + `FTN-NNN`，替代过去从大 .md 重新提取需求。

### 6.2 迁移原则

4. **复制式迁移，非破坏式。** 大 .md 的模块明细复制进 `modules/`/`foundations/`，做轻量重排（加 frontmatter、补溯源标注、调整结构），原 .md 瘦身成 `docs/spec/README.md` 总纲。原内容在 git 历史中保留，总纲顶部声明权威需求源已迁移。
5. **零代码改动、零 SPEC 回填、零已验收项重测。** 整个拆分迁移是纯文档操作。已完成的 SPEC-001~008 及其 closeout/runbook/handoff 全部原样保留。

### 6.3 向前：spec 驱动新开发

6. **新 SPEC 以 spec 文档为需求输入。** 新立项的 SPEC 在规格文档「需求来源」明确引用 `docs/spec/MOD-NNN`，确保需求与工程执行可追溯。
7. **规范变化只改 CONVENTIONS。** 本规范的任何调整（新增编号段、改模板字段、调命名规则）只修改本文件，并在顶部 `last_updated` 记录，不在各业务 spec 中各自定义规则。

## 7. 与现有文档的边界

- **与 `docs/专项设计/`**：spec 层不定义表结构、字段类型、API 路径、状态编码等技术契约，这些以专项设计为准。spec 层用 `design_refs` 指向对应专项设计。
- **与 `docs/superpowers/specs/`**：spec 层是需求输入，superpowers spec 是工程执行规格。一个 MOD 文档可能由多个 SPEC 分批落地（如 MOD-001 由 SPEC-002/003/004/005 落地）。
- **与原 `律所闭环管理系统需求开发文档.md`**：迁移完成后，该文件瘦身成 `docs/spec/README.md` 总纲，权威需求明细迁移至 `modules/`/`foundations/`。原文件在 git 历史保留。
