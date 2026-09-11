# 全局表格列宽与中文显示实施记录

依据：[SPEC-UI-20260911](../specs/2026-09-11-table-resize-chinese.md)。

- [x] 调查岗位前后端编码契约及既有分类，先建立规格。
- [x] 共用 ResizableTable 支持拖动、键盘调整、双击/Home 恢复、浏览器记忆和存储失败降级。
- [x] 30 个业务表格文件统一接入，修正固定表头样式，保留选择、分页、排序和固定列行为。
- [x] ChineseConfig 统一控件语言，补齐账号/权限/数据范围/管理操作/沟通等中文显示。
- [x] 岗位编码中文显示、自动生成稳定编码；分类中文选择，提交原值且编辑不改变旧编码。
- [x] 283 项全量回归中 282 项首次通过；1 项旧英文断言更新后，15 项相关复测全部通过。类型、变更 lint、构建通过。全 src lint 仅 User/Notification 原有两处警告。
- [x] Edge 浏览器列宽实际变化、持久化、恢复、固定列、选择/排序/分页验收通过，已检查截图。
- [x] 更新 TRACE、MOD-001 和 MOD-002；前后端本地健康检查通过，无数据库变更。

验证产物：`C:/Users/HW/AppData/Local/Temp/table-full-results.json`、`table-final-targeted-results.json`、`table-build-final.log`；浏览器截图在 `C:/Users/HW/AppData/Local/Temp/table-browser-tests-final/`。测试源位于 `apps/web/src/components/ResizableTable.test.tsx`、`src/locales/business-labels.test.ts`、`src/pages/Position/index.test.tsx`、`src/pages/PermissionTrace/index.test.tsx` 和 `e2e/table-resize.spec.ts`。
