# Event Center CLI 安全输出契约

范围：仅依据 `check-events.ts`、`drain-events.ts` 的 formatter、状态类型与退出分支提取；不包含配置值、地址、凭据、业务数据、原始错误或运行时标识。

## 输出形态

- preflight、canary 与 drain 的成功输出均为一条 stdout 记录：固定前缀后接空格分隔的 `name=value` 字段，并以一个换行结束。
- formatter 本身不产生多行输出；一次成功调用不可能产生多行成功记录。
- preflight 与 canary 的字段集合相同，仅 `mode` 值不同。

## preflight / canary

顶层字段（按 formatter 顺序）：

`mode`, `status`, `undispatched`, `oldestUndispatchedSeconds`, `dueBacklog`, `oldestDueBacklogSeconds`, `manual`, `processing`, `expiredProcessing`, `staleExpiredProcessing`, `leaseLost15m`, `alertCodes`, `evaluatedAt`

- `mode` 允许值：`preflight`, `canary`
- `status` 允许值：`READY`, `DEGRADED`, `BLOCKED`
- 计数类字段：`undispatched`, `dueBacklog`, `manual`, `processing`, `expiredProcessing`, `staleExpiredProcessing`, `leaseLost15m`
- 时长数值字段：`oldestUndispatchedSeconds`, `oldestDueBacklogSeconds`

退出码映射：

- `0`：`READY`
- `3`：`DEGRADED`
- `4`：`BLOCKED`
- `2`：输入或配置无效
- `5`：迁移或数据库状态不可用
- `70`：其他未分类运行失败

## drain

顶层字段（按 formatter 顺序）：

`dispatched`, `claimed`, `succeeded`, `retryScheduled`, `manual`, `leaseLost`, `status`

- `status` 允许值：`complete`, `manual_attention_required`
- 计数字段：`dispatched`, `claimed`, `succeeded`, `retryScheduled`, `manual`, `leaseLost`

退出码映射：

- `0`：`status=complete`
- `4`：`status=manual_attention_required`
- `2`：输入或配置无效
- `5`：迁移或数据库状态不可用
- `70`：其他未分类运行失败
