---
id: CONVENTIONS
title: 当前实现Spec维护约定
type: meta-spec
last_updated: 2026-11-06
---

# 当前实现Spec维护约定

## 1. 本轮授权及效力

本轮按用户“现有spec与OA冲突时以现在成果为准”的要求反向校准文档，不要求为了旧spec改写已验收代码。当前MOD/FTN覆盖事实范围；历史设计、closeout和计划保留原验收时间及上下文，不追写为本轮全部验证。

## 2. 分层

| 层 | 位置 | 维护方式 |
|---|---|---|
| 当前规格 | docs/spec/README、modules、foundations | 功能、约束、权限、联动、边界、验收要求 |
| 当前参考 | docs/spec/reference | 从路由、权限、模板和schema生成，可复现核对 |
| 差异与追溯 | CHANGES、TRACE、ACCEPTANCE | 旧→新口径、证据、检查结果和限制 |
| 旧版快照 | history/2026-11-06-before-alignment | 原需求编号与历史细节；不作为当前事实 |
| 专项/工程历史 | docs/专项设计、两处superpowers/specs及plans/reports | 不重写历史验收；当前索引引导到现行基线 |

## 3. 编号与状态

保留MOD-001至013及FTN-001至007和原文件路径，历史功能ID在各规格末尾追溯，不复用编号。`implemented-baseline`表示依据特定代码快照整理，不能解读为所有历史目标全实现或本轮全量测试通过。

区分：已实现（有代码依据）、用户人工验收（用户陈述）、本轮验证（实际执行的检查）、历史测试（有文件/报告）、待规则/未开放、需外部环境验收。仅有一个模型或接口桩不能认定功能交付。

## 4. 变更纪律

新增功能先明确目标和授权；实现后同步模块、共享契约、数据/接口/权限/字段附录及回归入口。若未来代码改变现行行为，按新提交更新source_commit并记录原因；不能只写一句“以代码为准”掩盖冲突。

不得以修正文档为名改权限、清数据、重新部署或重写业务状态。字段说明必须区分存储键/中文名、元数据必填/服务必填、可写/投影/待规则、普通表/正式表。

## 5. 生成与检查

从仓库根，使用满足Node22要求的环境执行：

```powershell
node LayerManage/law-firm-system/apps/server/node_modules/tsx/dist/cli.mjs docs/spec/tools/export-current.ts
node LayerManage/law-firm-system/apps/server/node_modules/tsx/dist/cli.mjs docs/spec/tools/export-current.ts --check
python docs/spec/tools/validate-current.py
node LayerManage/law-firm-system/apps/server/node_modules/tsx/dist/cli.mjs docs/spec/tools/check-documents.ts
```

生成器仅读取源文件及导出字段函数，不连接数据库；源码中的模板为默认定义，不替代已有库的schemaVersion和个别表配置。工具依赖应用已安装依赖；Python检查器只使用标准库。变更仅文档时不必重置业务库或重复全量业务测试，仍应执行链接、引用、清单一致性和机密泄漏检查。

## 6. 历史保留

[旧维护规范](history/2026-11-06-before-alignment/CONVENTIONS.md)记载早期迁移规则。此次用户明确要求以已开发成果对齐，覆盖其“仅从旧PRD复制”“不得改专项索引”等不适用的迁移约束；已完成计划和验收报告仍保持原历史事实。
