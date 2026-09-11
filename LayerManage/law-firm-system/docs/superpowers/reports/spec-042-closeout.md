# SPEC-042 案件文件/证据管理（Case File & Evidence Management）— 收尾报告

日期：2026-08-05 ｜ 需求来源：案件办理域已建（SPEC-033/035），但**案件文件/证据管理缺失**（模型未建）——律师办案刚需 ｜ 用户授权自主推进（「按你推荐执行候选follow-up」）｜ 前置：SPEC-033（案件域权限/服务/controller 基础设施）
设计权威：本文档 ｜ 计数基线：SPEC-041 终态（迁移 29/模型 60/权限 132/事件 15/路由 28）

## 1. 交付范围

案件文件/证据台账——base64 上传落盘 + 列表 + 下载 + 删除 + 前端案件详情集成。**结构性变更**（迁移 29→**31** +2：新表 + provisioning；模型 60→**61** +CaseFile；权限 132→**134** +2；路由 28→**32** +4；事件 15 不变）。

1. **Task 1（模型 + 迁移 + 权限码）**：`CaseFile` 模型（id/caseId/fileName/fileType/filePath/fileSize/uploadedBy/createdAt + case 级联删 + `@@index([caseId])`）+ 迁移 `20260805130000_case_file` + 权限 +2（`case.file.read`/`case.file.manage`，resource 沿用 'case'）+ provisioning 迁移 `20260805130010_case_file_permission_provision` + baseline 同步（迁移 31/模型 61 + 计数断言 134 五处 + schema-contract 61）。
2. **Task 2（case-file-service + controller + 路由）**：`case-file-service`（upload——案件存在 404 + 非终态 409 + base64 校验/10MB 超限 400 + UUID 落盘 + 审计；list——分页；download——读盘 base64 信封；remove——删盘 + 记录 + 审计）+ `case-errors.ts` +`CASE_FILE_NOT_FOUND`/`CASE_FILE_INVALID` + `case-factory.ts` +`caseFileService` + `controller/case.ts` +4 方法 + `router.ts` +4 条；服务测试 2 例。
3. **Task 3（本报告）**：API 测试 4 例 + 前端文件区 + 闸门 + runbook §10 补 + 本 closeout。

**变更文件（共 7 后端 + 3 前端 + 2 测试 + 3 文档）**：Task 1 `schema.prisma` + `20260805130000_case_file` + `authorization-types.ts` + `permission-catalog.ts` + `20260805130010_case_file_permission_provision` + `check-baseline-contract.ts`（31/61）+ 计数断言五处 + `schema-contract.test.ts`；Task 2 `case-file-service.ts` + `case-factory.ts` + `case-errors.ts` + `case-types.ts` + `controller/case.ts` + `router.ts` + `test/case/case-file-service.test.ts`；Task 3 `test/app/case-file-api.test.ts` + 前端 `pages/Case/index.tsx` + `api/business.ts` + `types/index.ts` + `features/authorization/types.ts` + `CasePage.test.tsx` + runbook §10 + 本 closeout。

## 2. 工具链

Node test runner（串行 `--test-concurrency=1 --test-force-exit`）/ Vitest + Playwright（前端）/ Node v24.18.0。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true；127.0.0.1；skip-pattern 排除 spec-008 排练 3 例。全程零 git 操作。撞车纪律沿用。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| case-file 服务测试（`test/case/case-file-service.test.ts`） | **2/2 pass**（upload 落盘+审计/案件 404/终态 409/非法 base64 400/403；list 过滤/download base64/remove 删盘/404/403） |
| case-file API 测试（`test/app/case-file-api.test.ts`） | **4/4 pass**（401/403/端到端上传→列表→下载→删除/错误码 404/400） |
| 前端 Case 页 Vitest（`CasePage.test.tsx`） | **10/10 pass**（原 9 例 + 文件列表渲染/上传门控 1 例） |
| 前端全量 Vitest | **48 files / 238 tests 全绿**（Case 页 +1 净增，零回归） |

### 3.2 文件闸门

| 检查 | 结果 |
|---|---|
| server tsc + eslint（case 域 + controller + router + 测试） | **0 err** |
| web tsc + eslint（Case 页 + api + types + 测试） | **0 err** |
| web build（`tsc -b` + vite） | **exit 0** |
| `security:test`（root） | **57/57 pass** |
| `security:audit:all`（root） | **server + web 双 passed=true** |
| `check:baseline`（**31 迁移** / **61 模型**） | **pass**（exit 0） |
| `check:bootstrap` | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**结构性变更**：迁移 **29→31**（+2：`20260805130000_case_file` 新表 + `20260805130010_case_file_permission_provision` provisioning）；模型 **60→61**（+CaseFile）；权限 **132→134**（+2，catalog + provisioning 双源一致）；事件 **15** 不变；路由 **28→32**（+4 requirePermission）。`check:baseline`（31/61）+ schema-contract（61）已同步。

## 5. 关键裁决记录（D1-D7 + 实施期 ⚠️ 记录）

| # | 决策 | 值 |
|---|---|---|
| D1 | CaseFile 模型 | id/caseId/fileName/fileType/filePath/fileSize/uploadedBy/createdAt + case 级联删 |
| D2 | 权限 | +2：case.file.read / case.file.manage（resource 沿用 'case'） |
| D3 | 存储 | base64 上传落盘 `var/storage/case-files/<uuid>`（UUID 防路径穿越）+ 10MB 上限 |
| D4 | 服务 | upload/list/download/remove + 审计 |
| D5 | controller + 路由 | +4 方法 + 4 条路由（/cases/:id/files、/files/:id） |
| D6 | 前端 | 案件详情文件区（列表/上传/下载/删除 + 门控） |
| D7 | 安全 | base64 预检正则 + 解码异常 400；UUID 落盘；fileName 仅元数据 |

**实施期 ⚠️ 记录**：

- **迁移计数 29→31（非 30）**：计划初估 +1 迁移，实际 +2（新表 + provisioning 两迁移）——check-baseline/design/plan 已修正为 31。
- **base64 上传（无 egg-multipart）**：项目未装 egg-multipart 依赖——采用 **base64 信封上传**（FileReader.readAsDataURL → 前端剥前缀 → 后端 Buffer 解码落盘；下载读盘 base64 信封 → 前端 Blob 触发下载），零新依赖。
- **前端陈旧闭包坑**：`openDetailWithFiles` 捕获初始渲染 `fetchFiles`（`detail` 为 null）→ 文件列表不拉取——修 `fetchFiles(caseId?)` 显式传参（沿用任务/沟通重拉的全链路刷新）。
- **磁盘文件清理**：remove 删盘 + DB 记录；test.after 由 `clearTestApplicationData` 清 case_file 表，磁盘文件由各测试 remove 清理。
- **权限计数核对行**：runbook §10「权限计数核对」陈旧 129 → 修正 134（顺带）。

## 6. 安全审计状态

- `security:test` **57/57**（本 SPEC 零安全变更）。
- `security:audit:all` **server + web 双 passed=true**，production high=0/critical=0。
- `check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **文件预览**（图片/PDF 内联渲染）——另行（设计 §6 OUT）。
2. **外部存储**（S3/OSS）——本地盘 base64 起步（设计 §6 OUT）。
3. **文件版本/签核流**——另行（设计 §6 OUT）。
4. **上传方式**：base64 信封（无 multipart 依赖）——大文件（>10MB）受限，可 follow-up 加 multipart。
5. **承接既有已知项**：trust-root-guard ×2 外部漂移（SPEC-022，归外部渠道）；SEC-2026-002（react-router v8）保留观察；前端预存 vitest flake。

## 8. 对账项

- **结构性变更对账**：迁移 **31**（+2）/模型 **61**（+CaseFile）/权限 **134**（+2）/事件 15/路由 **32**（+4）——`check:baseline`（31/61）+ `check:bootstrap` PASS。
- **存储对账**：base64 上传 → `var/storage/case-files/<uuid>`（UUID 文件名，fileName 仅元数据）；下载读盘 base64 信封；remove 删盘 + 记录；案件级联删（case 删 → 记录删，磁盘文件由 remove 显式清理）。
- **审计对账**：CASE_FILE_UPLOAD/CASE_FILE_DELETE 落 operation_log（targetType CASE_FILE），actor=请求用户；读不落。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触。

## 9. Follow-up 路由（候选专项）

- **文件预览/外部存储**：图片/PDF 内联渲染 + S3/OSS 接入——另行。
- **multipart 上传**：>10MB 大文件（egg-multipart 依赖）——另行。
- **文件版本/签核流**：文件版本历史 + 审批签核——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。

## 10. 验收链

- **Task 1（模型 + 迁移 + 权限码）**：CaseFile 模型 + 2 迁移 + 权限 +2 + provisioning + baseline 同步 → `check:baseline`（31/61）+ schema-contract（61）PASS + 计数断言 134 全绿。
- **Task 2（文件服务 + 路由）**：case-file-service（upload/list/download/remove + 校验/审计）+ controller + 路由 → 服务 2/2 + tsc/eslint 0。
- **Task 3（本报告）**：API 4/4 + 前端 Case 页 10/10 + 全量 vitest 48/238 + `security:test` 57/57 + audit 双绿 + check:baseline/bootstrap/docs-leakage + web build 全 PASS + runbook §10 + 本 closeout 收口。

## 11. 收官状态

**SPEC-042 案件文件/证据管理本地闭环（2026-08-05）**：3/3 任务完成（Task 1 CaseFile 模型 + 2 迁移 + 权限 +2 + provisioning + baseline 同步；Task 2 case-file-service upload/list/download/remove + controller + 路由；Task 3 API 测试 + 前端案件详情文件区 + 闸门 + runbook §10 + closeout）。**结构性变更**：迁移 **29→31** / 模型 **60→61** / 权限 **132→134** / 事件 15 / 路由 **28→32**。聚焦验证：case-file 服务 **2/2** + API **4/4** + 前端 Case 页 **10/10** + 全量 vitest **48 files/238** + `security:test` **57/57** + `security:audit:all` 双绿 + check:baseline（**31/61**）+ check:bootstrap + docs-leakage + web build 全 PASS。实施期 ⚠️ §5（迁移计数 31 / base64 无 multipart / 前端陈旧闭包 / 磁盘清理 / 权限计数行修正），已知非阻断 §7，follow-up §9。**案件域端到端覆盖文件/证据管理——律师办案资料数字化台账可用**。按项目约束零 git 操作，本地闭环。
