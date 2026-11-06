> **历史设计说明（2026-11-06）**：本文保留原设计输入；当前OA行为、权限、字段、API和审批模式以 [现行Spec](../spec/README.md) 及 [差异清单](../spec/CHANGES-2026-11-06.md) 为准。下文计划或旧规则不覆盖当前实现。

# API 规范、错误码与事务边界设计

## 1. 通用规范

- 基础路径：`/api/v1`。
- JSON 字段使用 camelCase，数据库字段使用 snake_case。
- 时间返回 ISO 8601 UTC 字符串；金额返回字符串，避免浮点误差。
- 所有接口返回 `requestId`，服务端日志、事件和审计记录沿用同一 traceId。

```json
{
  "code": "OK",
  "message": "success",
  "data": {},
  "requestId": "req_xxx"
}
```

## 2. 列表与查询

| 参数 | 说明 |
|---|---|
| page | 页码，从 1 开始 |
| pageSize | 默认 20，最大 200 |
| sort | `field:asc` 或 `field:desc` |
| keyword | 关键词 |
| filters | 结构化过滤条件 |

列表返回 items、page、pageSize、total。数据范围由服务端注入，客户端不得传入任意 branchId 绕过授权。

## 3. 资源与动作接口

| 类型 | 示例 | 规则 |
|---|---|---|
| 资源查询 | `GET /contracts/{id}` | 读取对象和允许字段 |
| 资源创建 | `POST /leads` | 支持 Idempotency-Key |
| 资源更新 | `PATCH /customers/{id}` | 携带 version 做乐观锁 |
| 状态动作 | `POST /contracts/{id}/activate` | 不允许 PATCH 直接改状态 |
| 审批动作 | `POST /approval-tasks/{id}/approve` | 校验审批人和任务状态 |
| 配置动作 | `POST /config-versions/{id}/publish` | 校验审核结果和影响范围 |
| 干预动作 | `POST /data-interventions/{id}/execute` | 仅执行已审核的受控命令 |

## 4. 幂等与并发

1. 合同生效、收款确认、退款、案件建档、回调、事件消费必须幂等。
2. 客户端写接口使用 `Idempotency-Key`；服务端保存请求摘要和结果。
3. 外部流水、eventId、callbackKey、业务编号建立唯一约束。
4. 更新核心对象携带 version；版本不匹配返回 `BIZ_CONCURRENT_MODIFICATION`。
5. 同一对象的高风险状态动作使用数据库行锁或等价串行化手段。

## 5. 错误码

| 分类 | 示例错误码 | HTTP |
|---|---|---:|
| 认证 | AUTH_TOKEN_MISSING、AUTH_TOKEN_EXPIRED | 401 |
| 权限 | PERM_ACTION_DENIED、PERM_DATA_SCOPE_DENIED、PERM_FIELD_DENIED | 403 |
| 参数 | PARAM_INVALID、PARAM_REQUIRED、PARAM_FORMAT_ERROR | 400 |
| 不存在 | RESOURCE_NOT_FOUND | 404 |
| 冲突 | BIZ_INVALID_STATE、BIZ_DUPLICATE、BIZ_CONCURRENT_MODIFICATION | 409 |
| 审批 | APPROVAL_REQUIRED、APPROVAL_TASK_PROCESSED、APPROVAL_SELF_REVIEW_DENIED | 409 |
| 配置 | CONFIG_VERSION_INVALID、CONFIG_NOT_APPROVED、CONFIG_CORE_FIELD_PROTECTED | 409 |
| 外部服务 | EXTERNAL_AI_FAILED、EXTERNAL_STORAGE_FAILED | 502 |
| 限流 | RATE_LIMITED | 429 |
| 系统 | INTERNAL_ERROR、DATABASE_ERROR | 500 |

错误响应不得包含堆栈、SQL、密钥或客户敏感数据。

## 6. 事务边界

| 业务动作 | 同事务内容 | 异步内容 |
|---|---|---|
| 线索转客户 | 客户创建/匹配、线索状态、负责人、EventLog | 通知、统计 |
| 首签合同生效 | 合同、应收、材料任务、分析委托、EventLog | 消息、驾驶舱 |
| 正式合同生效 | 合同、应收、案件建档、风险告知、EventLog | SOP 任务扩展、统计 |
| 收款确认 | Payment、PaymentPlan、Contract、EventLog | 客户全景缓存、驾驶舱 |
| 客户合并 | 主档、关联迁移、映射、审计、EventLog | 搜索索引刷新 |
| 配置发布 | ConfigVersion、PublishRecord、审核状态、EventLog | 缓存和页面配置刷新 |
| 数据干预 | 申请状态、业务变更、前后快照、AuditLog、EventLog | 管理通知 |

## 7. 安全与审计

- 服务端逐接口校验操作、数据范围、字段和特殊权限。
- L3/L4 数据下载、导出和查看原值写 AuditLog。
- API 日志记录路径、耗时、响应码、requestId，不记录密码、API Key 和完整录音内容。
- 文件下载使用短时签名 URL 或受控流式接口。

## 8. 版本兼容

- 破坏性接口变更发布新主版本；同版本只新增可选字段。
- 事件结构通过 eventVersion 演进，消费者声明支持版本。
- 废弃字段至少保留一个发布周期并记录替代字段。

