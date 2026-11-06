# OA当前API规范入口

2026-11-06，基线dcf8447d。此路径统一维护应用API入口；原API_SPEC.md与api-spec.md两套命名的内容分别归入历史快照，后者保留兼容跳转说明，避免维护两套互相冲突的规范。

## 当前契约

- [408项HTTP注册清单](../../../docs/spec/reference/HTTP-API.md)：方法、路径、控制器、路由权限与退役标记。
- [API、事务、版本与错误](../../../docs/spec/foundations/FTN-004-api-transaction-consistency.md)：鉴权、输入、并发、幂等、业务回写和错误反馈。
- [权限及范围交集](../../../docs/spec/foundations/FTN-003-rbac-data-scope.md) 与 [199项权限代码](../../../docs/spec/reference/PERMISSIONS.md)。
- [当前审批执行契约](../../../docs/spec/foundations/FTN-006-approval-task-notification.md)：/api/v1/workflows；旧审批API返回410。
- [标准工作表字段](../../../docs/spec/reference/STANDARD-FIELDS.md) 与 [数据模型](../../../docs/spec/reference/DATA-MODELS.md)。

请求body、响应和字段校验应同时查注册清单所指controller/service。所有业务写入必须保留领域权限、记录范围、字段能力和状态校验；不能把路由级未声明requirePermission解读为公共接口。共享配置不直接扩大业务数据权限。

## 历史

[原大写API_SPEC](../../../docs/spec/history/2026-11-06-before-alignment/api/application-api-uppercase.md) 与 [原小写api-spec](../../../docs/spec/history/2026-11-06-before-alignment/api/application-api-lowercase.md) 保留旧细节及历史语义，不描述当前接口。
