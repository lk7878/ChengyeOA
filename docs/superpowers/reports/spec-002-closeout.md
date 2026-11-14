# SPEC-002 Closeout Report — 首次系统初始化与超级管理员信任根

## Status

SPEC-002（首次系统初始化与超级管理员信任根）按台账已闭环（memory ledger「SPEC-001..015 ALL LOCALLY CLOSED」；SPEC-003/004/005 均以 SPEC-002 为前置并引用其交付）；本报告补写缺失的 closeout 文件（doc-reconciliation）。9 个计划任务（trust-root schema / 安全原语 / 原子引导 / 受控恢复 / 薄 CLI / 认证服务 / 信任根保护 / Web 强制改密 / CI 契约 + runbook）交付物全部在盘并经核对。

## Delivered Scope

- **Trust-root schema**：迁移 `20260715120000_system_bootstrap_trust_root`——`SystemInitialization`（固定主键 `PRIMARY`）/ `Role.code` 唯一 / `User.mustChangePassword`·`credentialVersion`·`failedLoginCount`·`lockedUntil`·`passwordChangedAt` / `LoginLog` 安全事件列（userId 可空 + usernameSnapshot + outcome + reasonCode，`ON DELETE SET NULL`）。
- **安全原语**（`app/domain/security/`）：`validateUsername`/`validatePassword`（12–128、四类取三、不含用户名、弱密码清单、bcrypt cost 12）/ `BcryptPasswordHasher` / `JwtTokenService`（tokenType + credentialVersion 声明，access 7d / refresh 30d / password_change 5m）。
- **原子引导** `SystemBootstrapService`：`pg_advisory_xact_lock(2036071502)` 并发互斥、脏库失败关闭（无 `--force`）、单事务创建六类记录 + `SYSTEM_BOOTSTRAP` 审计、审计失败整体回滚、`AlreadyInitializedError` 拒绝重复。
- **受控离线恢复** `SuperAdminRecoveryService`：`ALLOW_SUPER_ADMIN_RECOVERY=true` 精确门、仅初始化指向的首位超级管理员、原因 10–500、临时密码 + 强制改密 + `credentialVersion` 递增（旧令牌全失效）+ `SUPER_ADMIN_RECOVERY` 审计。
- **薄 CLI**（`scripts/system/`）：`system:bootstrap` / `super-admin:recover`，隐藏输入、脱敏目标、`INITIALIZE <dbName>` / `RECOVER <dbName> <username>` 确认短语、稳定退出码 `0/2/3/4/5/6/70`、禁 `--password`/参数/env 传密。
- **认证服务** `AuthenticationService`：首次登录只签发 5 分钟改密令牌（`PASSWORD_CHANGE_REQUIRED`）、强制改密后重新登录、5 次失败锁定 15 分钟、统一 `AUTHENTICATION_FAILED`、凭证版本失效。
- **信任根保护** `trust-root-guard`：首位超级管理员/`SYSTEM_SUPER_ADMIN` 角色/根组织对既有变更 API 返回 `TRUST_ROOT_PROTECTED`（409）。
- **Web 强制改密**：`/password-change` 路由 + `PasswordChange` 页 + 内存态 `passwordChangeStore`（不落 localStorage/Cookie/URL）。
- **CI 契约 + runbook**：`check-bootstrap-contract.ts`（root/server 命令存在、无 HTTP 初始化/恢复入口、无 CLI 传密、无默认凭据）+ `system-bootstrap-and-super-admin-recovery.md` 运维手册。

## Verification Evidence

| Gate | Result |
| --- | --- |
| SPEC-002 聚焦组（10 文件：schema-contract / unittest-database / password-policy / token-service / system-bootstrap / super-admin-recovery / system-cli / auth / trust-root-guard / bootstrap-contract） | **241 tests / 238 pass / 3 fail**——3 fail = **2 已知外部漂移**（trust-root-guard ×2：`PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，SPEC-022 起逐 closeout 照录）+ **1 撞车**（concurrent bootstrap：`permission.createMany Unique constraint` 竞态签名；清净窗单独复跑该文件 16 tests 中 concurrent 用例 **通过**）→ **0 真 fail 归 SPEC-002** |
| `check:bootstrap`（契约：root/server 命令 + 无 HTTP 入口 + 无传密 + 无默认凭据） | **pass**（exit 0） |
| `check:baseline` | 现报 **28 vs 27**——外部渠道本会话加迁移 #28 `20260805110000_case_version_column`（案件乐观锁 follow-up）未同步基线契约，**照录非 SPEC-002**（SPEC-002 自身迁移 `20260715120000` 在盘、模型 60 不变） |
| 迁移/模型 | `20260715120000_system_bootstrap_trust_root` 在盘；模型 **60**（Case/CaseTask/Communication 为后续 spec 既有） |
| 交付物核对 | system-bootstrap / super-admin-recovery / trust-root-guard / authentication-service / scripts/system/* / check-bootstrap-contract / 前端 PasswordChange 页 / runbook 全部存在 |

**隔离复跑说明**：撞车类失败随外部渠道共享 test DB 活动**翻转**（不同 run 命中不同测试的 setup），清净窗隔离复跑即绿——与 SPEC-034 观测一致，共享工作树 + 共享 test DB 撞车纪律（runbook §8）沿用。

## Deferred Scope（设计 §3 非目标，后续 spec 承接）

- MFA / SSO / 设备会话安全（身份认证专项，**超级管理员生产上线门槛**——MFA 完成前不宣称完整生产安全就绪）。
- 第二位超级管理员（`add-second-super-admin` 已随后补）、完整管理员治理（SPEC-005）。
- 组织树/岗位/员工（SPEC-003）、RBAC/数据范围/敏感权限（SPEC-004）。
- 业务数据初始化（后续各业务域 spec）。

## Coordination Notes

- 本 closeout 补写缺失文档；SPEC-002 功能实现早于 closeout 惯例，本次核对全部交付物在盘。
- 当前树外部在制：迁移 #28（case_version_column）、权限 129——契约计数闸门（check:baseline）受外部漂移影响，**归外部渠道**（案件办理 SPEC-033 后续 + 本 spec 无关）。
- 按项目约束零 git 操作；本地闭环。
