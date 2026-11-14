# SPEC-039 客户复购与转介绍业务流程（Referral Workflow）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进（「按你的推荐继续」——业务链最后一步「客户复购与转介绍」的实际流程）｜ 需求来源：SPEC-032 只做了复购/转介绍分析指标（contractCount/repurchaseCount/referralCount），**转介绍登记流程与客户转介绍视图未建** ｜ 前置：SPEC-009（线索 CRM/客户主数据——`Lead.referralCustomerId`/`sourceType REFERRAL`/`Customer.referrals` 基础设施已建）、SPEC-032（客户经营分析）
设计权威：本文档 ｜ 计数基线：SPEC-037 终态（迁移 29/模型 60/权限 132/事件 15/路由 26）

## 1. 背景与目标

业务链最后一步「客户复购与转介绍」——SPEC-032 已提供**分析指标**（客户详情「经营分析」卡：复购数/转介绍数），但**转介绍业务动作缺失**：无「客户详情登记转介绍」流程、无客户转介绍线索列表视图。数据基础设施已就绪（`Lead.referralCustomerId` + `sourceType REFERRAL` + `Customer.referrals` 关系；lead create 已支持 referral 字段 + 去重信号 + 幂等）。**目标**：构建转介绍登记流程（客户域绑定） + 客户转介绍线索视图 + 前端集成。复购为派生指标（合同数>1），无独立动作——沿用 SPEC-032。**零结构变更**（迁移/模型/权限/事件全不变；路由 26→**28** +2）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 转介绍登记 | `lead-service.createReferralLead(customerId, input)`——校验客户存在（404 `CUSTOMER_NOT_FOUND`）+ **强制** `sourceType=REFERRAL` + `referralCustomerId=customerId`（防伪造）→ 委托 `createLead`（去重信号/幂等/事件/公海记录复用）+ 审计；权限 `lead.create` |
| D2 | 客户转介绍列表 | `lead-service.listReferrals(customerId, query)`——校验客户存在（404）+ 过滤 `referralCustomerId` + `sourceType REFERRAL` + 分页 `PagedResult<LeadView>`；权限 `lead.read`（返回 LeadView，字段投影按 lead 字段权限——非 customer.read） |
| D3 | controller + 路由 | `controller/customer.ts` +`createReferral`/`listReferrals`；路由 +2（`POST`/`GET /api/v1/customers/:id/referrals`）→ 26→**28** |
| D4 | 前端 | 客户详情「转介绍」区——登记转介绍 Modal（name/phone/wechat/intentionLevel）+ 转介绍线索列表（编号/姓名/电话/意向/状态/来源）+ 经营分析卡完善（转介绍数跳转） |
| D5 | 零结构变更 | 迁移 29/模型 60/权限 132/事件 15 全不变（复用 lead.create/customer.read 权限，零新码）；路由 26→28 |

## 3. 实现

### 3.1 Task 1：转介绍后端流程

- `lead-errors.ts`：+`CUSTOMER_NOT_FOUND`（404）码。
- `lead-service.ts`：
  - `createReferralLead(customerId, input)`：`lead.create` → 客户存在探针（404）→ `assertExactKeys(['name','phone','wechat','intentionLevel','tags'])` → 委托 `this.createLead({...input, sourceType:'REFERRAL', referralCustomerId: customerId})`（去重信号/幂等/事件复用）。
  - `listReferrals(customerId, query)`：`customer.read` → 客户存在探针（404）→ `listLeads` 式过滤（`referralCustomerId` + `sourceType:'REFERRAL'` + `deletedAt null`）+ 分页。
- `controller/customer.ts`：+`createReferral`（POST，lead.create）/ `listReferrals`（GET，lead.read）。
- `router.ts`：+2 条 `/api/v1/customers/:id/referrals`（POST 挂 lead.create、GET 挂 lead.read）。

### 3.2 Task 2：前端客户转介绍

- `pages/customers/CustomerDetailPage.tsx`：+「转介绍」区——登记转介绍按钮（Modal：name/phone/wechat/intentionLevel）→ `POST /customers/:id/referrals`；转介绍线索列表（`GET /customers/:id/referrals`，分页）；经营分析卡转介绍数显示。
- `api/customer.ts`：+`createReferral`/`listReferrals`。
- 前端测试 +2（登记提交/列表渲染）。

## 4. 计数影响

**零结构变更**：迁移 29 / 模型 60 / 权限 132 / 事件 15 全不变；路由 **26→28**（+2）。后端测试 +N（~6），前端测试 +N（~2）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | createReferralLead（客户不存在 404 / 强制 REFERRAL+绑定 / 去重信号 / 审计）/ listReferrals（客户不存在 404 / 过滤+分页 / 权限 403） |
| API | 权限门禁 403（lead.create / customer.read）/ 401 / 错误码透传（404/400）/ 端到端登记+列表 |
| 前端 | 登记提交 / 转介绍列表渲染 / 权限门控 |

闸门纪律沿用：串行、127.0.0.1:55433、清净窗、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 范围边界（明确 OUT）

- 复购业务流程（复购为派生指标，无独立动作）——SPEC-032 已覆盖。
- 转介绍激励/佣金核算——另行（模型未建）。
- 转介绍线索深度漏斗（转介绍→邀约→成交归因链）——另行。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 用户授权自主推进（「按你的推荐继续」） |
