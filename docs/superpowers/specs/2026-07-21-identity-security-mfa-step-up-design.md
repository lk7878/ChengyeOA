# SPEC-006：身份安全、MFA 与高风险二次认证设计

日期：2026-07-21  
状态：设计已批准，待实施  
前置规格：SPEC-002、SPEC-004、SPEC-005

## 1. 背景

系统已经具备密码登录、强制改密、账号锁定、JWT 访问/刷新令牌、实时角色校验、超级管理员信任根，以及 HIGH/CRITICAL 管理员治理流程。但当前身份边界仍有以下生产阻断项：

1. 管理员只依赖密码，缺少第二认证因素。
2. 访问令牌有效期较长，刷新令牌没有服务端会话、轮换和重用检测。
3. 注销只清理客户端状态，不能撤销已签发凭据。
4. CRITICAL 操作的精确确认短语只证明操作意图，不能证明当前操作者仍掌握第二认证因素。
5. 缺少管理员丢失认证器后的受控恢复路径。

本规格建立服务端会话、标准 TOTP、多因素恢复和用途绑定的一次性 step-up 凭证，使管理员身份、会话与高风险操作形成可撤销、可审计、失败关闭的安全闭环。

## 2. 目标

1. `SYSTEM_SUPER_ADMIN` 和 `SYSTEM_ADMIN` 必须启用 TOTP MFA；普通用户第一版可选。
2. 密码登录后通过显式状态机完成强制改密、MFA 绑定或 MFA 验证。
3. 建立可撤销的服务端会话、短时访问令牌、刷新令牌轮换和重用检测。
4. HIGH/CRITICAL 管理员治理及身份安全操作必须执行近期二次认证。
5. step-up 凭证绑定当前会话、用途和目标，一次使用后失效。
6. 提供恢复码、受治理的管理员重置和本机 CLI 紧急恢复三层恢复机制。
7. 密钥、验证码、恢复码和临时凭证不得进入日志、持久化前端存储或治理快照。

## 3. 非目标

本规格不包含：

1. SAML/OIDC 单点登录和企业身份提供商接入。
2. WebAuthn、Passkey、硬件安全密钥或短信验证码。
3. 基于设备指纹的可信设备免验证。
4. 普通用户强制启用 MFA。
5. 对全部业务接口普遍增加 step-up；第一版只保护明确列出的安全与治理操作。

## 4. 已批准决策

### 4.1 强制范围

实时持有有效 `SYSTEM_SUPER_ADMIN` 或 `SYSTEM_ADMIN` 角色的用户必须具有已验证、未停用的 TOTP 因子。普通用户可自行绑定和使用 TOTP，但第一版不强制。

角色可能在会话期间发生变化，因此管理员强制策略必须在服务端实时判断，不能只依赖登录时写入 JWT 的角色。

### 4.2 MFA 方式

第一版只支持 RFC 6238 TOTP：

- SHA-1；
- 6 位数字；
- 30 秒周期；
- 验证窗口为当前时间片前后各 1 个时间片；
- 兼容 Microsoft Authenticator、Google Authenticator 等标准应用。

### 4.3 会话方案

采用服务端 `AuthSession` 记录，不采用纯无状态 JWT。访问令牌仍用于 API 身份传递，但必须引用活动会话；刷新令牌只能通过服务端保存的哈希进行轮换。

### 4.4 高风险认证方案

采用用途绑定、目标绑定、一次性消费的 step-up 凭证。现有 CRITICAL 精确确认短语继续保留：确认短语证明操作意图，TOTP 证明当前身份，两者不能相互替代。

## 5. 威胁模型与安全原则

重点防御：

1. 管理员密码泄露后直接登录或执行高危操作。
2. 被窃取访问令牌或刷新令牌长期有效。
3. 刷新令牌被复制后由攻击者和正常用户并行使用。
4. TOTP 验证码在同一时间窗口被重放。
5. 为一种操作签发的二次认证凭证被用于另一种操作或目标。
6. MFA 恢复流程绕过双人治理或最后一名超级管理员保护。
7. 日志、浏览器存储、审计快照或错误响应泄露认证秘密。

安全原则：服务端权威、最短有效期、一次性消费、默认拒绝、敏感信息不落日志、身份验证与业务变更事务一致。

## 6. 数据模型

### 6.1 `MfaFactor`

每个用户第一版最多一个活动 TOTP 因子。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `userId` | 用户；活动因子唯一 |
| `type` | 固定为 `TOTP` |
| `encryptedSecret` | AES-256-GCM 密文 |
| `secretIv` | 随机 IV |
| `secretAuthTag` | GCM 认证标签 |
| `keyVersion` | 密钥轮换版本 |
| `verifiedAt` | 首次验证完成时间；为空表示未绑定完成 |
| `lastAcceptedCounter` | 最近接受的 TOTP 时间片，防止重放 |
| `disabledAt` | 停用时间 |
| `createdAt` / `updatedAt` | 审计时间 |

数据库不得存储明文 TOTP secret 或完整 `otpauth://` URI。

### 6.2 `MfaRecoveryCode`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `factorId` | 所属 MFA 因子 |
| `codeHash` | 使用现有强密码哈希器生成的不可逆哈希 |
| `usedAt` | 使用时间；非空后永久失效 |
| `createdAt` | 创建时间 |

每次生成 10 个高熵恢复码，只在生成响应中展示一次。重新生成时旧码全部失效。

### 6.3 `AuthSession`

| 字段 | 说明 |
| --- | --- |
| `id` | 随机会话 ID，同时作为 JWT `sid` |
| `userId` | 用户 |
| `credentialVersion` | 创建时凭据版本 |
| `assuranceLevel` | `PASSWORD` 或 `MFA` |
| `refreshTokenHash` | 当前刷新令牌哈希 |
| `refreshGeneration` | 轮换代数 |
| `createdAt` / `lastSeenAt` | 会话时间 |
| `expiresAt` | 最长会话到期时间，默认 30 天 |
| `revokedAt` / `revokedReason` | 撤销信息 |
| `userAgentHash` | 仅保存规范化摘要，不保存完整浏览器字符串 |
| `ipPrefix` | 可选的脱敏网段，仅用于审计展示 |

任一请求发现用户停用、锁定、强制改密、凭据版本不匹配、管理员缺少 MFA 或会话已撤销时均失败关闭。

### 6.4 `AuthChallenge`

密码阶段完成后，强制改密、MFA 绑定和 MFA 验证均使用服务端挑战记录；返回给客户端的挑战令牌只是随机引用，数据库只保存其哈希。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `userId` | 用户 |
| `type` | `PASSWORD_CHANGE`、`MFA_ENROLLMENT` 或 `MFA_VERIFY` |
| `tokenHash` | 随机挑战令牌哈希 |
| `failedAttempts` | 当前失败次数 |
| `maxAttempts` | 默认 5 |
| `expiresAt` | 挑战到期时间 |
| `consumedAt` | 成功消费时间 |
| `createdAt` | 创建时间 |

同一用户创建新挑战时废止同类型旧挑战。挑战过期、消费或达到最大失败次数后不得恢复使用；冷却状态由用户近期挑战失败记录计算，不能通过重复调用登录接口绕过。

### 6.5 `StepUpGrant`

| 字段 | 说明 |
| --- | --- |
| `id` | 随机 ID |
| `sessionId` | 当前活动会话 |
| `userId` | 操作者 |
| `purpose` | 固定目录中的操作用途 |
| `targetDigest` | 对规范化目标负载计算的 SHA-256 摘要 |
| `tokenHash` | 返回给客户端的一次性随机凭证哈希 |
| `expiresAt` | 5 分钟后到期 |
| `consumedAt` | 消费时间 |
| `createdAt` | 创建时间 |

step-up 原始凭证只返回一次，不落日志；业务服务在变更事务内锁定并消费对应记录。

## 7. 密钥管理

新增部署密钥 `MFA_ENCRYPTION_KEY_V1`，解码后必须为 32 字节。服务启动时若生产环境缺失或格式错误必须拒绝启动。

1. TOTP secret 使用 AES-256-GCM 加密。
2. 每个因子使用独立随机 96 位 IV。
3. `keyVersion` 为未来密钥轮换保留；第一版只写 V1，但读取逻辑按版本选择密钥。
4. 密钥不得写入代码库、示例真实值、日志、错误响应或备份说明正文。
5. 数据库备份不包含部署密钥；恢复演练必须单独验证密钥安全注入。

## 8. 登录状态机

### 8.1 密码阶段

`POST /api/v1/auth/login` 校验用户名和密码，继续保留未知用户虚拟哈希、通用失败信息、失败计数和账号锁定。

成功后只返回以下一种状态。所有临时令牌均为至少 256 位随机不透明值，服务端只保存哈希：

| 状态 | 条件 | 返回内容 |
| --- | --- | --- |
| `PASSWORD_CHANGE_REQUIRED` | 必须改密 | 5 分钟内存型改密令牌 |
| `MFA_ENROLLMENT_REQUIRED` | 管理员没有已验证因子 | 10 分钟绑定令牌 |
| `MFA_CHALLENGE_REQUIRED` | 用户已有活动因子 | 5 分钟挑战令牌 |
| `AUTHENTICATED` | 普通用户未启用 MFA | 访问令牌和刷新会话 |

密码正确但尚未完成 MFA 时不得更新 `lastLoginAt`，也不得创建正式会话。

### 8.2 首次绑定

1. 客户端使用绑定令牌调用 `POST /api/v1/auth/mfa/enrollment`。
2. 服务端创建未验证因子，返回一次性的 secret、人工输入键和 `otpauth://` URI。
3. 客户端本地生成二维码；不得将 URI 发送给第三方二维码服务。
4. 用户输入 TOTP 调用 `POST /api/v1/auth/mfa/enrollment/confirm`。
5. 服务端在事务中验证验证码、标记因子、生成恢复码并创建 MFA 会话。
6. 响应只展示一次恢复码；前端要求用户明确确认已保存。

未完成绑定的因子 15 分钟后可被安全替换；同一用户最多保留一个未完成因子。

### 8.3 MFA 挑战

`POST /api/v1/auth/mfa/verify` 接受挑战令牌和 TOTP 或恢复码。成功后创建 `assuranceLevel=MFA` 的会话并返回认证结果。

TOTP 验证在事务内锁定因子并比较 `lastAcceptedCounter`；计数器不大于已接受值时拒绝。恢复码成功使用时在同一事务内写入 `usedAt`。

### 8.4 失败限制

单个 MFA 挑战最多失败 5 次，随后失效并冷却 15 分钟。服务端挑战记录负责原子累加失败次数；限流同时按用户和来源网段实施，错误响应不区分因子不存在、验证码错误、恢复码已用等内部原因。

## 9. 访问令牌、刷新与注销

1. 访问令牌默认有效期由 7 天缩短为 15 分钟，包含 `sub`、`sid`、`credentialVersion`、`amr`，类型仍为 `access`。
2. 刷新令牌为至少 256 位随机不透明值；数据库只保存哈希，不再使用可离线重复验证的长期 JWT。
3. 每次刷新采用行锁并轮换刷新令牌，旧令牌立即失效。
4. 已轮换旧令牌再次出现视为重用：撤销整个会话并记录安全审计事件。
5. 会话绝对有效期默认 30 天，不因刷新无限延长。
6. `POST /api/v1/auth/logout` 必须撤销当前会话；`POST /api/v1/auth/logout-all` 撤销用户全部会话。
7. 修改密码、管理员 MFA 重置、用户停用或凭据版本变化时撤销该用户全部会话。

第一版继续通过 Authorization Bearer 传递短时访问令牌。访问令牌只保存在运行内存；刷新凭据使用限定 `/api/v1/auth` 路径的 `HttpOnly`、`Secure`、`SameSite=Strict` Cookie。开发环境允许非 Secure Cookie，但生产配置不得降级。所有依赖 Cookie 的状态变更接口必须校验受信任 `Origin`，并使用双提交 CSRF token；CSRF token 可以被前端读取，但不得包含身份凭据。

## 10. 管理员强制策略

每次受保护请求加载实时授权上下文后执行：

1. 若用户是 `SYSTEM_SUPER_ADMIN` 或 `SYSTEM_ADMIN`，必须存在活动、已验证的 TOTP 因子。
2. 当前会话 `assuranceLevel` 必须为 `MFA`。
3. 不满足时返回 `MFA_REQUIRED` 或 `MFA_ENROLLMENT_REQUIRED`，不执行控制器。
4. 普通用户会话期间被授予管理员角色后，现有 PASSWORD 会话立即不能访问受保护接口，必须重新登录并完成绑定或验证。
5. 管理员角色被撤销后不自动降低既有会话安全等级，但实时授权仍决定其权限。

## 11. 高风险 step-up

### 11.1 保护范围

第一版要求 step-up 的操作：

1. 创建 HIGH 或 CRITICAL 管理员治理申请。
2. 批准 HIGH 或 CRITICAL 管理员治理申请。
3. 重试已批准但未完成的 HIGH 或 CRITICAL 操作。
4. 停用本人 MFA、重新生成恢复码。
5. 重置其他管理员 MFA。
6. 撤销其他会话或执行全设备退出。

拒绝或撤销治理申请不会扩大权限，第一版不强制 step-up，但仍要求正常授权和审计。

### 11.2 用途和目标

服务端维护固定 `purpose` 目录，例如：

- `ADMIN_GOVERNANCE_CREATE`
- `ADMIN_GOVERNANCE_APPROVE`
- `ADMIN_GOVERNANCE_RETRY`
- `MFA_DISABLE_SELF`
- `MFA_RECOVERY_CODES_REGENERATE`
- `ADMIN_MFA_RESET`
- `SESSION_REVOKE`
- `SESSION_REVOKE_ALL`

客户端提交规范化目标负载；服务端按用途选择允许字段、稳定排序、序列化并计算摘要。签发和消费必须使用同一服务端规范化函数，客户端摘要不具权威性。

### 11.3 签发与消费

1. 活动 MFA 会话调用 `POST /api/v1/auth/step-up`，提交 `purpose`、目标负载和 TOTP。
2. 服务端验证 TOTP、防重放及权限先决条件，创建 5 分钟一次性 `StepUpGrant`。
3. 客户端仅在内存中保存凭证，并通过 `X-Step-Up-Token` 发送到目标接口。
4. 目标业务服务在同一数据库事务中校验用户、会话、用途、目标摘要、有效期和未消费状态。
5. 先标记 `consumedAt`，再执行高风险业务写入；任一业务写入失败时整个事务回滚，凭证仍可在有效期内重试。
6. 成功提交后凭证不可再次使用。

CRITICAL 治理创建继续校验现有精确确认短语。确认短语不得写入 `StepUpGrant` 或审计快照。

## 12. MFA 管理与恢复

### 12.1 自助管理

普通用户和管理员都可查看 MFA 状态和活动会话。以下规则适用：

- 启用 MFA 必须先验证 TOTP。
- 停用 MFA 需要 step-up；当前仍持有管理员角色时禁止停用。
- 重新生成恢复码需要 step-up，生成后旧码全部失效。
- 使用恢复码登录后仍建立 MFA 会话，但立即提示重新绑定或补充恢复码；恢复码不得自动禁用因子。

### 12.2 他人重置

新增治理操作 `ADMIN_MFA_RESET`，风险等级 CRITICAL：

1. 申请人与审核人必须是不同的有效超级管理员。
2. 申请创建和批准均要求 step-up。
3. 不能由目标本人审核。
4. 执行时停用目标因子、作废恢复码、撤销全部会话、递增 `credentialVersion`。
5. 目标下次密码登录进入 `MFA_ENROLLMENT_REQUIRED`。

### 12.3 唯一超级管理员紧急恢复

本机 CLI 增加 MFA 紧急重置能力，仅用于没有第二名可用超级管理员且恢复码全部丢失的场景：

1. 明确选择目标数据库并显示脱敏连接目标。
2. 要求目标账户当前密码重新验证。
3. 要求输入包含数据库名和用户名的精确确认短语。
4. 在事务中确认目标仍是有效 `SYSTEM_SUPER_ADMIN`。
5. 停用因子、作废恢复码、撤销全部会话、递增凭据版本。
6. 写入 `source=RECOVERY` 的不可省略审计事件，不记录密码、TOTP secret 或恢复码。
7. 下次登录强制重新绑定 MFA。

CLI 不提供输出现有 TOTP secret、恢复码或绕过密码验证的能力。

## 13. API 契约

新增或调整的主要接口：

| 方法和路径 | 用途 |
| --- | --- |
| `POST /api/v1/auth/login` | 返回显式认证状态 |
| `POST /api/v1/auth/mfa/enrollment` | 开始绑定，返回一次性 URI |
| `POST /api/v1/auth/mfa/enrollment/confirm` | 确认绑定并返回恢复码 |
| `POST /api/v1/auth/mfa/verify` | TOTP 或恢复码登录 |
| `GET /api/v1/auth/mfa` | 查询当前状态 |
| `DELETE /api/v1/auth/mfa` | 停用本人 MFA |
| `POST /api/v1/auth/mfa/recovery-codes` | 重建恢复码 |
| `POST /api/v1/auth/step-up` | 签发一次性 step-up 凭证 |
| `POST /api/v1/auth/refresh` | 轮换刷新凭据 |
| `POST /api/v1/auth/logout` | 撤销当前会话 |
| `POST /api/v1/auth/logout-all` | 撤销全部会话 |
| `GET /api/v1/auth/sessions` | 列出当前用户活动会话 |
| `DELETE /api/v1/auth/sessions/:id` | 撤销指定会话 |

错误码至少包括：

- `MFA_ENROLLMENT_REQUIRED`
- `MFA_CHALLENGE_REQUIRED`
- `MFA_REQUIRED`
- `MFA_INVALID`
- `MFA_CHALLENGE_EXPIRED`
- `MFA_RATE_LIMITED`
- `STEP_UP_REQUIRED`
- `STEP_UP_INVALID`
- `STEP_UP_EXPIRED`
- `STEP_UP_PURPOSE_MISMATCH`
- `STEP_UP_TARGET_MISMATCH`
- `SESSION_REVOKED`
- `REFRESH_TOKEN_REUSED`

对外错误信息保持通用，具体失败原因只进入已脱敏的安全审计字段。

## 14. 前端设计

1. 登录页依据状态机切换密码、强制改密、MFA 绑定和 MFA 验证步骤。
2. 绑定页显示本地生成的二维码、人工输入键、验证码输入和恢复码一次性下载/复制确认。
3. TOTP、恢复码、绑定令牌、挑战令牌和 step-up 凭证只保存在组件内存或会话内存，不写 `localStorage`、Zustand 持久化或 URL。
4. 访问令牌只保存在运行内存；页面刷新通过 HttpOnly 刷新 Cookie 恢复会话。
5. HIGH/CRITICAL 操作提交前打开统一 step-up 对话框。验证成功后立即提交原操作，不长期缓存授权。
6. CRITICAL 页面先显示影响摘要和确认短语，再执行 TOTP step-up；界面明确说明两项校验用途不同。
7. 设置页提供 MFA 状态、恢复码重建和会话管理；管理员不能停用强制 MFA。

## 15. 审计与可观测性

必须记录：

- MFA 绑定成功、停用、重置；
- TOTP 或恢复码验证成功/失败的脱敏结果；
- 恢复码使用和重建；
- 会话创建、刷新、撤销、刷新令牌重用；
- step-up 签发、拒绝、消费、过期；
- CLI 紧急恢复。

审计记录允许包含用户 ID、会话 ID、用途、目标摘要、结果、来源网段和时间；禁止包含密码、TOTP secret、完整 URI、验证码、恢复码、令牌原文、Cookie 或 Authorization 头。

安全日志写入失败时，MFA 重置、step-up 消费及受保护业务变更必须失败并回滚。

## 16. 迁移与兼容

1. 数据库迁移只新增表、索引和必要枚举，不自动为用户生成因子。
2. 部署后普通用户可以继续使用密码登录；管理员第一次成功输入密码后进入强制绑定。
3. 现有访问/刷新 JWT 在发布切换时统一失效，要求所有用户重新登录；前端启动时清除旧版 `auth-storage` 中的访问和刷新令牌。
4. 前端发布必须与服务端状态机和 Cookie 变更同步，不支持新旧认证协议混跑。
5. 发布前确认至少两名可用超级管理员并分别完成 MFA 绑定；若当前仅一名，则先验证 CLI 紧急恢复流程。

## 17. 测试策略

### 17.1 单元测试

- TOTP 生成、窗口、计数器防重放；
- secret 加密/解密、错误密钥和认证标签失败；
- 恢复码哈希与一次性使用；
- step-up 规范化、目标摘要、用途匹配和过期；
- 刷新令牌生成、哈希、轮换和重用识别。
- 挑战令牌哈希、失败计数、消费、冷却和并发边界。

### 17.2 服务与 API 测试

- 四种登录状态和通用失败响应；
- 管理员强制绑定、普通用户可选绑定；
- 绑定确认并发、重复验证码、挑战限流；
- 访问会话撤销、真实注销、全设备退出；
- 刷新轮换并发和旧令牌重用后整会话撤销；
- HIGH/CRITICAL 创建、批准、重试缺少或错配 step-up 时失败；
- step-up 与业务写入同事务回滚；
- 管理员角色在会话期间授予后的失败关闭；
- MFA 重置的禁止自审和最后信任根保护；
- CLI 密码验证、精确确认、事务和审计。

### 17.3 前端测试

- 登录状态机和刷新恢复；
- 二维码本地生成与恢复码确认；
- step-up 对话框和 CRITICAL 双重确认顺序；
- 敏感值不进入 localStorage、URL、错误提示或持久化 store；
- 401、MFA_REQUIRED、SESSION_REVOKED 的统一退出和重登录行为。
- Cookie 刷新接口的受信任来源和 CSRF 校验。

### 17.4 安全验收

1. 管理员没有 MFA 或 PASSWORD-only 会话时不能访问受保护接口。
2. 同一 TOTP 时间片不能成功使用两次。
3. step-up 凭证不能跨会话、用途、目标或请求重复使用。
4. 注销、改密、MFA 重置后旧访问和刷新凭据均失效。
5. 刷新令牌重用触发整会话撤销。
6. 数据库、日志、审计和浏览器持久化存储中不存在明文认证秘密。

## 18. 实施顺序

1. 先以测试固定密码、TOTP、会话和 step-up 契约。
2. 增加 Prisma 模型、迁移和密钥配置校验。
3. 实现 TOTP、secret 加密、恢复码和会话领域服务。
4. 重构登录、刷新、注销和认证中间件。
5. 实现 step-up 服务并接入 SPEC-005 HIGH/CRITICAL 流程。
6. 实现 MFA 管理、治理重置和 CLI 紧急恢复。
7. 改造前端登录状态机、MFA 设置、会话管理和 step-up 对话框。
8. 完成单元、API、接受、浏览器和安全回归测试。
9. 更新环境示例、运行手册、恢复手册和发布门禁。

## 19. 完成定义

只有同时满足以下条件才可关闭 SPEC-006：

1. 本规格的功能、安全和恢复验收全部通过。
2. 服务端、前端和安全测试全绿，既有 SPEC-002/004/005 回归无退化。
3. 管理员强制 MFA 和 HIGH/CRITICAL step-up 在服务端失败关闭。
4. 生产环境密钥缺失时服务拒绝启动，敏感数据泄漏检查通过。
5. CLI 紧急恢复和数据库备份恢复场景均完成演练。
6. 文档说明现有会话失效影响、管理员上线顺序和回滚方式。
