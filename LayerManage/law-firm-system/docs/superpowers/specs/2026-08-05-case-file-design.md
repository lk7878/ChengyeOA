# SPEC-042 案件文件/证据管理（Case File & Evidence Management）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进（「按你推荐执行候选follow-up」——案件域缺文件/证据管理，SPEC-033/035 closeout §9 明确另行）｜ 需求来源：案件办理域已建（SPEC-033/035），但**案件文件/证据管理缺失**（模型未建）——律师办案刚需 ｜ 前置：SPEC-033（案件域权限/服务/controller 基础设施）
设计权威：本文档 ｜ 计数基线：SPEC-041 终态（迁移 29/模型 60/权限 132/事件 15/路由 28）

## 1. 背景与目标

案件办理域缺**文件/证据管理**：无 CaseFile 模型、无上传/下载/删除能力、前端案件详情无文件区。**目标**：构建案件文件/证据台账——上传（base64 落盘，无需 egg-multipart 依赖）+ 列表 + 下载 + 删除，案件详情前端集成。**结构性变更**（迁移 29→**31** +2：新表 + provisioning；权限 132→**134** +2；路由 28→**32** +4；模型 60→**61** +1；事件 15 不变）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | CaseFile 模型 | `CaseFile`：id/caseId/fileName/fileType/filePath/fileSize/uploadedBy/createdAt；`case` 关系 onDelete Cascade；`@@index([caseId])` |
| D2 | 权限 | +2：`case.file.read`（列表/下载）/ `case.file.manage`（上传/删除）——catalog + provisioning 迁移 |
| D3 | 存储 | `var/storage/case-files/`（运行时建目录）；**base64 上传**（POST body `{ fileName, mimeType, base64 }`）→ 解码落盘（UUID 文件名防路径穿越）+ DB 记录；**大小上限 10MB**（base64 长度校验） |
| D4 | 服务 | `case-file-service`：`upload(caseId, input)`（案件存在 404 + 非终态 + 校验 + 落盘 + 审计 CASE_FILE_UPLOAD）/ `list(caseId)`（分页）/ `download(fileId)`（读盘返回 base64 + 元数据信封）/ `remove(fileId)`（删盘 + 记录 + 审计 CASE_FILE_DELETE） |
| D5 | controller + 路由 | `controller/case.ts` +`listFiles`/`uploadFile`/`downloadFile`/`removeFile`；路由 +4（GET/POST `/cases/:id/files`、GET `/files/:id/download`、DELETE `/files/:id`）→ 28→**32** |
| D6 | 前端 | 案件详情「文件」区：列表（文件名/类型/大小/上传人/时间）+ 上传（FileReader base64）+ 下载（Blob）+ 删除；case.file.read/manage 门控 |
| D7 | 安全 | base64 解码异常/超限 400；文件名仅存元数据（落盘用 UUID）；mimeType 白名单宽松（text/image/pdf 等） |

## 3. 实现

### 3.1 Task 1：模型 + 迁移 + 权限码 + provisioning

- `prisma/schema.prisma`：`model CaseFile`（字段见 D1；`case Case @relation(... onDelete: Cascade)`）。
- 新迁移 `20260805130000_case_file/migration.sql`：`CREATE TABLE "case_file" (...)` + FK + index。
- `authorization-types.ts`：`PERMISSION_CODES` +2 + `RESOURCE_CODES` 沿用 'case'（action `file.read`/`file.manage`）。
- `permission-catalog.ts`：+2 条目。
- provisioning 迁移 `20260805130010_case_file_permission_provision`（+2 permission 行）。
- `check-baseline-contract.ts`：迁移 29→**31** + 模型 60→**61**。
- 计数断言 132→**134** 五处 + schema-contract 模型数。

### 3.2 Task 2：case-file-service + controller + 路由

- `app/application/case/case-file-service.ts`：upload（base64 解码→`var/storage/case-files/<uuid>` 写盘→DB 记录→审计）/ list / download（读盘→base64 信封）/ remove（删盘→DB 删除→审计）。
- `case-factory.ts`：+`caseFileService(ctx)`。
- `case-errors.ts`：+`CASE_FILE_NOT_FOUND`（404）/ `CASE_FILE_INVALID`（400）。
- `errorHandler.ts`：CaseError 分支已覆盖（复用）。
- `controller/case.ts`：+4 方法；`router.ts` +4 条。

### 3.3 Task 3：前端文件区 + 测试 + 闸门 + runbook + closeout

- `pages/Case/index.tsx` 详情抽屉 +「文件」区（列表/上传/下载/删除 + 门控）。
- `api/business.ts` caseApi +`listFiles`/`uploadFile`/`downloadFile`/`removeFile`。
- `types` +CaseFile。
- API 测试（上传/列表/下载/删除 + 权限 403 + 404）+ 服务测试 + 前端测试。

## 4. 计数影响

**结构性变更**：迁移 **29→31**（+1 新表）/ 模型 **60→61**（+CaseFile）/ 权限 **132→134**（+2）/ 事件 15 不变 / 路由 **28→32**（+4）。后端测试 +N（~8），前端测试 +N（~3）。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | upload（案件 404/非终态拒/大小超限 400/落盘+审计）/ list / download（文件缺失 404）/ remove（删盘+审计） |
| API | 上传流程（base64→落盘→列表→下载→删除）/ 权限 403 / 404 / 大小超限 400 |
| 前端 | 文件区列表/上传/下载/删除 / 门控 |

闸门纪律沿用：串行、127.0.0.1:55433、清净窗、`_test` 库、55432 禁触、撞车期间禁跑。

## 6. 范围边界（明确 OUT）

- 文件预览（图片/PDF 内联渲染）——另行。
- 外部存储（S3/OSS）——本地盘 base64 起步。
- 文件版本/签核流——另行。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D7 | 见 §2 | 用户授权自主推进（「按你推荐执行候选follow-up」） |
