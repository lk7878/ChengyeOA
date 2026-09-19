# SPEC-PW-RESET-20260919：账号管理管理员重置密码

状态：已实现并验证，先规格后实现。关联 MOD-001 账号管理（ORG-15）。

## 需求来源

用户要求：管理中心-账号管理中支持重置账号密码，且该能力仅管理员可用。此前账号密码只能通过创建账号时设定、员工离职禁用、以及离线恢复脚本（super-admin:recover）处理，缺少面向普通用户账号的管理员在线重置入口。

## 功能契约

1. 新增权限 `user.password.reset`（ACTION，resource=user，action=password.reset，风险 CRITICAL）。系统超级管理员通过全量权限目录自动拥有；系统管理员与业务「管理员」角色需在角色权限中显式勾选获得，不得通过普通业务角色隐式继承。

2. 新增接口 `POST /api/v1/users/:id/password-reset`，路由门控 `requirePermission('user.password.reset')`。请求体仅接受 `password`、`confirmation` 两个字段。两次输入必须一致；新密码满足统一密码策略：12–128 位、至少 3 类字符（大写/小写/数字/符号）、不含用户名、非弱口令、无控制字符、无首尾空白。

3. 行为与边界：
   - 目标用户必须对操作者可见，按 `user.password.reset` 的数据范围求交，不可见目标返回 404 而非 403（不泄露账号存在性）。
   - 操作者不得重置自己的密码，返回明确错误；自改密码走「账号安全」的 step-up 流程。
   - 信任根与系统管理员账号保护：不得在线重置初始超级管理员（PRIMARY 信任根）以及持有 SYSTEM_ADMIN/SYSTEM_SUPER_ADMIN 角色的账号；前者走离线恢复脚本，后者走管理员治理流程。
   - 新密码不得与当前密码相同（PASSWORD_REUSED）。
   - 成功后在一个事务内：写入新密码哈希、`mustChangePassword=true`、`passwordChangedAt=now`、`failedLoginCount=0`、`lockedUntil=null`、`credentialVersion` 自增（使该账号全部旧会话的访问令牌与刷新令牌立即失效）；写入审计（仅记录目标账号与结果，不记录密码明文）。使用行锁保证并发安全。

4. 前端账号管理列表操作列新增「重置密码」按钮，仅 `user.password.reset` 权限可见；对操作者本人不显示（后端仍强制校验）。弹窗二次输入密码并确认，成功后提示目标用户下次登录须修改密码并刷新列表，失败保留输入并展示明确原因。

## 验证及实施顺序

先更新规格及追溯；实现权限目录、接口、事务服务、前端入口；新增后端测试覆盖越权 403、不可见 404、自重置拒绝、信任根/管理员账号保护、密码策略与二次确认不一致、密码复用、会话失效、审计与并发；执行前后端 typecheck/lint 及相关回归；本地冒烟后更新开发库并核对账号与权限记录不变。

## 实施与验证结果

- 新增权限 `user.password.reset`（ACTION/user/password.reset/CRITICAL）并同步前后端权限码类型；迁移 `20260919000000_user_password_reset` 仅插入权限目录，不改动既有角色与授权。
- 后端 `UserController.resetPassword` 与路由 `POST /api/v1/users/:id/password-reset` 落地：按权限与数据范围门控、禁止自重置、信任根与系统管理员账号保护、密码策略/二次确认/复用校验、事务行锁、`mustChangePassword`/`credentialVersion` 自增与审计写入。
- 前端账号管理列表新增「重置密码」入口（仅 `user.password.reset` 权限且非本人可见），弹窗二次输入并确认，成功后提示目标账号下次登录须改密。
- 新增后端集成测试 7 项通过：超级管理员重置普通用户并强制改密/旧会话失效/审计不含明文、无权限 403、自重置 400、系统管理员账号 409、信任根 409、弱密码/不一致/复用 400、范围外目标 404。
- 前端 typecheck 与 eslint 通过；后端 tsc --noEmit 通过。迁移已部署到两个隔离测试库并验证 68 项迁移。
