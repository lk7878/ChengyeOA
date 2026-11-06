# 2026-11-06 文档对齐校验记录

## 基线与范围

实现基线为Git `dcf8447d`；用户已确认当前功能人工测试完成。本次修改为Markdown规范、索引、历史快照和只读文档维护工具，不修改OA业务实现、运行配置或数据库。

核对来源包括前端路由/导航、权限目录、正式业务工作表适配、标准模板、可视化审批、日历/评论、仪表盘及Prisma模型。历史设计和旧API原文保留追溯；旧API环境配置示例已脱敏。

## 检查命令

从仓库根运行，Node使用已安装的22.x，Python使用本机可用的3.x；检查均不连接数据库。

```powershell
node LayerManage/law-firm-system/apps/server/node_modules/tsx/dist/cli.mjs docs/spec/tools/export-current.ts --check
python docs/spec/tools/validate-current.py
node LayerManage/law-firm-system/apps/server/node_modules/tsx/dist/cli.mjs docs/spec/tools/check-documents.ts
git diff --check HEAD
```

## 结果记录

2026-11-06实际执行结果：

| 检查 | 结果 |
|---|---|
| export-current.ts --check | 通过；重新计算与5份已生成附录内容一致 |
| 静态清单 | 48组/730字段、125模型、89迁移目录、408路由、94导航项、199权限 |
| validate-current.py | 通过；58份当前/入口文档、449个本地链接，错误0 |
| 历史快照链接 | 既有缺失链接0 |
| 项目敏感信息规则扫描 | 通过；本轮83份Markdown，发现0；旧API环境示例在归档时已脱敏 |
| git diff --check HEAD | 通过；无差异空白错误 |

检查过程中修正了一处转介绍源码引用，并明确核对了案件显示号为全库序列、售后解除合同字段保持空值、仪表盘不自动继承个人视图筛选，以及资源OWNER/DENY规则。未根据历史建议改变业务实现。

## 验证限度

没有重跑全量业务测试、浏览器人工场景或生产部署；已有测试文件仅作为后续回归入口。本轮没有新增账号、调整LMJ权限、清理业务记录、启动数据库迁移或向GitHub推送。

字段附录是代码标准模板，不是对人工测试数据库全部自定义字段的实库快照。迁移清单是源码目录，不证明目标数据库已应用。待规则字段、未开放产品能力和外部发布门禁在对应模块说明。
