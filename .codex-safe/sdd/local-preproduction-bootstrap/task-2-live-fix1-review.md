# Task 2 Live Fix 1 独立复审

## Verdicts

- SPEC_COMPLIANCE: BLOCKED
- TASK_QUALITY: BLOCKED
- Critical: 0
- Important: 1
- Minor: 1
- Acceptance blockers: 1
- Live loader gate: READY

本次 live 修复解决了真实环境中“合法绝对但当前不存在的 inherited PATH 项导致过度阻断”的问题。只跳过这类确实不存在的项本身是安全的：它当前不能提供候选命令，固定工具目录仍被置于 Process PATH 前端，并且提交后仍执行规范路径一致性和精确版本复核。

当前实现的判定范围比该授权更宽：它跳过所有“不是目录”的项，包括已经存在的普通文件或其他非目录对象。因此本轮不能通过规范与测试质量验收。

## Findings

### Important 1 — 实现未区分“不存在”与“已存在但不是目录”

- File/line: `.codex-safe/Load-ChengyeOALocalPreproduction.ps1:274`, `:281`, `:287`, `:290`, `:291`
- 当前逻辑先规范化并登记 PATH 项；随后只要 `Test-Path` 的目录类型检查为 false 就直接继续。该结果同时覆盖“路径不存在”和“路径存在但不是目录”。
- 授权仅允许忽略语法合法、绝对且确实不存在的 inherited PATH 项。已存在的非目录项属于无效 PATH 结构，不能被静默接受。
- 该偏差不会让普通文件直接提供 npm 或 Node shadow，但会削弱 fail-closed 的结构约束，也会把不可访问或类型异常的既存对象与真正不存在项混为一类。
- Bounded fix: 规范化和重复检查后，先做不限定类型的存在性判断；仅在确认完全不存在时继续。若对象存在，再强制要求其为目录，否则返回稳定的 `TOOLCHAIN_VERSION_MISMATCH`。保留后续唯一 npm、shadow、提交后规范路径和精确版本检查。

### Minor 1 — 新测试没有锁定放宽边界的反例

- File/line: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:42`, `:46`, `:81`, `:1336`
- 新增用例只证明一个不存在目录的绝对项可获得 READY；没有证明已存在普通文件必须 BLOCKED，也没有为重复的不存在绝对项提供显式回归用例。
- 当前生产代码仍静态拒绝重复规范路径，既有矩阵也继续覆盖 schema/JSON、相对、引号、空项、npm 非唯一、Node/npm shadow、版本和启动失败；但缺少上述边界用例使 Important 1 未被测试发现。
- Bounded fix: 新增两个受控 child cases：已存在普通文件作为 inherited PATH 项必须 BLOCKED；同一不存在绝对项重复出现必须 BLOCKED。两者均要求单一安全记录、无额外流、无 Process 残留变化和稳定工具链告警。

## Preserved Controls

- Resolver JSON 必须是精确的双字段标量结构；缺失、额外、错误类型、畸形和多记录输出继续 BLOCKED。
- 空、带引号、相对或不能规范化的 child PATH 项继续 BLOCKED。
- 规范化后的重复 PATH 项在存在性跳过之前检查，静态逻辑继续 BLOCKED。
- 报告的 Node 文件必须存在、为预期叶名，并在提交前返回精确版本。
- npm 候选只从存在目录中发现；精确匹配必须唯一。
- 固定目录间的 npm/Node shadow、环境回退、多个 npx 和 npm 歧义继续 BLOCKED。
- PATH 提交后仍通过实际命令搜索验证规范文件一致性，并再次执行精确 Node/npm 版本检查。
- 仅导入 16 个 Process 变量，production 必须精确，Worker 必须精确关闭；User/Machine 写入和远程 Worker toggle 均为 0。
- 事务快照、18 个提交位置、17 次非短路回滚、来源感知的 rollback readiness 和单一全流安全记录没有发现回归。

## Fresh Sanitized Test Evidence

- Focused Task 2 loader: total 23, passed 23, failed 0, skipped 0, elapsed 80 seconds.
- Full Task 1–4 PowerShell suite: total 95, passed 95, failed 0, skipped 0, elapsed 102 seconds.
- Aggregate: total 118, passed 118, failed 0, skipped 0.
- 绿色测试不消除 Important 1，因为现有矩阵没有构造已存在非目录项。

## Live Loader Gate Evidence

- Live loader gate: READY.
- Safe loader records: 1.
- Additional stream records: 0.
- Forbidden captured-output matches: 0.
- Exact Node version Boolean: 1.
- Exact npm version Boolean: 1.
- Exact production mode Boolean: 1.
- Worker disabled Boolean: 1.
- Environment imported count: 16.
- Toolchain-ready count: 1.
- Elapsed seconds: 5.

真实 gate 证明当前机器的固定工具链、受保护环境与安全输出可正常加载；它不证明所有 inherited PATH 对象类型均符合放宽边界。

## Operation Counts

- Sanitized Pester invocations: 2.
- Real loader gate invocations: 1.
- Plan-authorized npx resolver invocations: 1.
- Database operations: 0.
- Container operations: 0.
- Initializer operations: 0.
- Bootstrap operations: 0.
- Interactive input requests: 0.
- Git operations: 0.
- GitHub operations: 0.
- Review artifact writes: 1.

## Acceptance Boundary

Task 2 live fix 1 保持 BLOCKED，直到 loader 只跳过经确认完全不存在的合法绝对项、对已存在非目录项 fail closed，并以新增反例测试证明该边界。修复后应重新运行 focused、full 与一次隔离真实 loader gate。
