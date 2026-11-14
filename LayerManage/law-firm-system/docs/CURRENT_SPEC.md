# 当前开发成果与Spec入口

基线：2026-11-06，Git dcf8447d。以现有OA实现对齐需求，旧PRD、API草案和阶段计划不覆盖当前规范。

- [产品总纲与20份模块/基础规格](../../../docs/spec/README.md)
- [冲突和修订口径](../../../docs/spec/CHANGES-2026-11-06.md)
- [导航及菜单权限](../../../docs/spec/reference/NAVIGATION.md)
- [HTTP接口注册](../../../docs/spec/reference/HTTP-API.md)
- [权限代码](../../../docs/spec/reference/PERMISSIONS.md)
- [工作表标准字段](../../../docs/spec/reference/STANDARD-FIELDS.md)
- [数据模型和迁移](../../../docs/spec/reference/DATA-MODELS.md)
- [验证说明](../../../docs/spec/ACCEPTANCE.md)

本目录原API_SPEC.md与api-spec.md（大小写及分隔符不同）曾各自描述API，现统一以 [API_SPEC.md](API_SPEC.md)，两个旧版本分别保存在历史快照，小写路径保留兼容说明。apps/server/docs/api-spec.md标记为历史说明。

标准字段清单来自代码模板，既有数据库可以有自定义/归档字段，运行时权限和schemaVersion仍为实际编辑依据。此次不操作数据库、账号或业务数据。
