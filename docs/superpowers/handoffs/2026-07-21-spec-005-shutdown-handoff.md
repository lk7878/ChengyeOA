# SPEC-005 临时关机 Handoff

> 更新时间：2026-07-21 19:15（Asia/Shanghai）  
> 状态：按用户要求暂停；Task 11 实现已写入但尚未执行 GREEN 验证  
> 恢复原则：直接继续全部剩余任务，不在每个 Task 边界询问；仅遇到无法自行消除的硬阻塞时请用户处理

## 1. 工作区与安全边界

- 仓库根目录：`D:\2_test\16_ChengyeOA`
- 应用根目录：`D:\2_test\16_ChengyeOA\LayerManage\law-firm-system`
- 服务端：`D:\2_test\16_ChengyeOA\LayerManage\law-firm-system\apps\server`
- 前端：`D:\2_test\16_ChengyeOA\LayerManage\law-firm-system\apps\web`
- 当前分支：`codex/spec-004-rbac-data-scope`
- 当前 HEAD：`1341f74cec03c68ba8e4200e0fffebe59de198bc`
- 工作树包含 SPEC-004、SPEC-005 的大量有意未提交修改和新增文件。不得清理、覆盖或回退。
- 用户明确要求：不要执行任何 Git/GitHub 写操作，不要 stage、commit、merge、push 或创建 PR。

## 2. 权威文件

- 设计：`docs/superpowers/specs/2026-07-21-admin-governance-super-admin-review-design.md`
- 实施计划：`docs/superpowers/plans/2026-07-21-admin-governance-super-admin-review-implementation.md`
- 逐项日志：`docs/superpowers/reports/spec-005-task-log.md`
- 本交接：`docs/superpowers/handoffs/2026-07-21-spec-005-shutdown-handoff.md`

恢复时先完整阅读本文件，再阅读实施计划中 Task 11 和 Task 12；不要重新执行已完成的 Task 1–10。

## 3. 已完成状态

Task 1–10 已完成并在 `spec-005-task-log.md` 留有验证证据：

1. 治理持久化、迁移、权限和保留系统角色。
2. 代码内治理内核、目录、错误、严格解析器。
3. SYSTEM_ADMIN fail-closed 权限模型。
4. append-only store、查询范围和脱敏详情。
5. 管理员账户适配器。
6. 事务型主数据命令和适配器。
7. 申请、审核、执行、撤销、重试/恢复、事件与工厂。
8. 第二名超级管理员恢复 CLI。
9. 七个治理 HTTP API。
10. 前端类型、API、授权摘要、路由与菜单。

最近已确认的验证结果：

- Task 7 全部 admin-governance 回归：48/48。
- Task 8 相关服务、CLI、恢复和 bootstrap 回归：150/150；server build 通过。
- Task 9 API/router/middleware：8/8。
- Task 10 前端相关测试：18/18；typecheck 通过；lint 为 0 error，仅 9 个无关旧 warning。

## 4. 暂停点：Task 11

### 4.1 已先建立 RED 基线

新增：

- `apps/web/src/pages/AdminGovernance/index.test.tsx`

在页面仍是占位内容时运行：

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm exec -- vitest run src/pages/AdminGovernance/index.test.tsx
```

结果：4 个测试全部按预期失败，原因是工作台尚不存在。该结果只证明 RED；之后已写实现但尚未重跑。

测试覆盖目标：

- 系统管理员仅能看到“我的申请”，并可打开目录驱动的新建抽屉。
- 超级管理员可见“待我审核/全部记录”，但自己的申请不显示审核动作。
- 仅合格记录显示撤销或重试，详情展示不可变快照和执行失败轨迹。
- 明确区分空状态和 API 加载失败，并可重新加载。

### 4.2 已写入但未验证的实现

新增/替换：

- `apps/web/src/features/admin-governance/components/OperationCreateDrawer.tsx`
- `apps/web/src/features/admin-governance/components/OperationDetailDrawer.tsx`
- `apps/web/src/features/admin-governance/components/ReviewDialog.tsx`
- `apps/web/src/pages/AdminGovernance/index.tsx`
- `apps/web/src/pages/AdminGovernance/governance.css`

当前实现包括：角色化 Tabs、状态/操作/日期筛选、横向表格、目录驱动申请表、组织/岗位/专业团队精确元数据字段、关键操作确认短语、审核意见规则、自审/目标冲突隐藏、撤销、失败重试、APPROVED 恢复入口、详情审核/执行轨迹以及加载/空/错误状态。

### 4.3 恢复后的第一步

不要继续新增功能。先运行以下命令获取真实编译和测试错误，然后按 systematic-debugging + TDD 修到 GREEN：

```powershell
cd D:\2_test\16_ChengyeOA\LayerManage\law-firm-system\apps\web
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm exec -- vitest run src/pages/AdminGovernance/index.test.tsx src/features/admin-governance/api.test.ts
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm run typecheck
```

实现刚写完就收到关机要求，因此不存在 Task 11 的 GREEN 结论。任何失败都应视为当前正常恢复入口，不要误报回归。

### 4.4 已识别、必须解决的设计缺口

管理员账户治理需要 `expectedTargetVersion`，服务端适配器比较的是敏感的 `User.credentialVersion`；现有 `/v1/users` 安全投影不暴露该字段，前端目前临时显示“账户安全版本”手工输入框。这不是可接受的最终 UX。

恢复后应先检查设计/服务端边界并实现安全的版本交换方案，推荐：治理专用、权限受控的目标查询返回不泄露凭据语义的 `governanceVersion`，或使用服务端签发的不透明版本令牌；不要直接把 `credentialVersion` 加回通用 `SAFE_USER_SELECT`。需要同时补 API 合约测试和前端测试。

还需重点检查：

- 新建抽屉测试打开后会调用用户和主数据 API，目前页面测试只 mock 了治理 API，可能出现 jsdom 网络错误；补齐 mock。
- Ant Design 6 的 Drawer 可访问名称、DatePicker 类型、Table column 推断和 `Form.useWatch` 可能产生测试/typecheck 差异。
- 申请提交失败必须保留同一个 idempotency key；关闭后重新打开才生成新 key。
- 主数据元数据字段必须保持精确白名单：Organization 仅 `sort`、Position 仅 `responsibilities`、ProfessionalTeam 仅 `description`。

## 5. Task 11 完成门槛

按计划补齐/校正交互测试后，必须全部通过：

```powershell
cd D:\2_test\16_ChengyeOA\LayerManage\law-firm-system\apps\web
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm exec -- vitest run src/pages/AdminGovernance/index.test.tsx src/features/admin-governance/api.test.ts
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm run typecheck
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm run lint -- --no-fix
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm run build
```

完成后把 RED/GREEN、测试数、typecheck/lint/build 结果追加到 `spec-005-task-log.md`。

## 6. Task 12 剩余工作

严格按实施计划 Task 12 完成，不要只做浏览器演示：

1. 新增串行 PostgreSQL 验收套件，覆盖第二席 CLI、双人授予/撤销、自审拒绝、高风险审核前无副作用、低风险事后审核、并发审核、过期目标版本、最后超级管理员保护、幂等键冲突、payload tamper、失败事务回滚、审计时间线和普通用户拒绝。
2. 增加浏览器 fixture/Playwright 流程，真实验证系统管理员申请、超级管理员独立审核、状态与详情轨迹。
3. 在进行浏览器工作前，完整阅读：`C:\Users\HW\.codex\plugins\cache\openai-bundled\browser\26.715.52143\skills\control-in-app-browser\SKILL.md`。
4. 创建/更新 SPEC-005 运维 runbook，包含第二席恢复、治理失败、APPROVED 恢复、最后超级管理员保护、审计查询与敏感信息禁入日志。
5. 运行全量 server/web 测试、typecheck、lint、build、迁移/合同检查。
6. 最终恢复空应用数据库，并运行 empty-application-tables 断言。
7. 生成 SPEC-005 closeout 和证据索引，更新 `docs/superpowers/README.md`。

## 7. 环境与命令

固定使用 Node 22.14.0 / npm 10.9.2：

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm <command>
```

测试环境变量：

```text
NODE_ENV=test
DATABASE_URL=<redacted local development URL>
DATABASE_URL_TEST=<redacted local test URL>
JWT_SECRET=<generate a local value of at least 32 characters>
APP_KEYS=<generate two local application keys separated by a comma>
ALLOW_TEST_DB_RESET=true
```

关机前 PostgreSQL 容器状态为 healthy，端口为 `55432`。开机后先检查：

```powershell
docker compose -f D:\2_test\16_ChengyeOA\LayerManage\law-firm-system\infra\postgres\compose.yml up -d
docker compose -f D:\2_test\16_ChengyeOA\LayerManage\law-firm-system\infra\postgres\compose.yml ps
```

## 8. 恢复提示词

新会话可直接发送：

```text
请先完整阅读 docs/superpowers/handoffs/2026-07-21-spec-005-shutdown-handoff.md，按其中暂停点继续 SPEC-005。直接执行全部剩余任务，不要在每项任务边界询问；不要执行任何 Git/GitHub 写操作，并保留当前 dirty worktree。
```

## 9. 停止时事实

- 没有 stage、commit、merge、push 或 PR。
- 没有删除、清理或回退用户工作树。
- Task 11 当前代码只到“实现已写入、尚未验证”。
- Task 12 尚未开始。
- 关机前不需要再运行测试；下次恢复从第 4.3 节两条命令开始。
