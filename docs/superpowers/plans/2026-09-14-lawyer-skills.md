# 四类法律技能实施记录

依据 [SPEC-LAWYER-SKILLS-20260914](../specs/2026-09-14-lawyer-skills.md)。先写 Spec，再实现。

1. 只读参考五个选定来源，核验原生接口和关键法律来源。
2. 在 desktop-plugin/presets/lawyer 内整理四个技能及完整资源，配置相对技能目录，保留标准工具。
3. 用原生组合验证发现、加载、工具调用、中文路径、打包搬迁和结果输出，检查数据边界。
4. 更新说明和验证记录；必要参考已完成后处理原始参考目录，检查差异并提交本地 Git。

## 实现

四个入口和六个配套资源位于 desktop-plugin/presets/lawyer/skills，使用原生 skill-filesystem.customSkillDirs/baseUrl 加载，支持原生模型按需调用和 `/name` 显式调用。只有 lawyer preset，未引入诉讼费用或其他参考能力。合同、应诉与管辖共用 china-legal-query 的云端 Wiki/公开检索规则；没有移植 Python/Tavily 缓存代码或密钥。

desktop:build 将完整 preset 复制到 dist/desktop/presets；插件 npm files 包含 presets。修改后需重新 build 并退出重启客户端。原 C33 和导入快照只读；正式维护目录与根目录原始参考资料无运行依赖。

依据官方发布文本核验民诉法版本、级别管辖通知的适用范围及民法典时间效力规则，随包仅保留来源索引和核验方法，不复制旧省份金额表。其余规则按个案联网核验，不将技能包当作完整法律数据库。

## 验证（2026-09-14）

- Node 22.20.0：`node --test integrations/intelligence/desktop/tests/*.test.mjs`，12 项通过。新增技能头、相对资源、敏感模式扫描、分发声明及原生组合对照；仅 persona 与已批准 customSkillDirs 不同。
- `node integrations/intelligence/scripts/desktop.mjs build` 通过，完整 preset/技能资源进入构建目录。
- `npm pack --ignore-scripts --json --pack-destination <临时目录>` 通过，实际归档 19 个文件，包含 4 个 SKILL.md、6 个引用资源及原生组合；无原始参考资料和凭据。未发布到注册表。
- `node integrations/intelligence/desktop/tests/smoke.mjs` 最终通过：正式 Product Profile/原生 Loader、唯一 lawyer、原生中文目录选择、四技能目录进入模型、正文及六个引用资源加载、显式 `/contract-review`、read/cloud_wiki/web_search/web_fetch/write 实际执行与四份本地 Markdown 输出。原生 DeepSeek 搜索提供器调用隔离 HTTP 夹具，fetch 仅替换外部提供器，工具与输出渲染保持原生；无命中、503 失败可见，查询未含测试卷宗的私有标记或 OA 凭据。
- 烟测将桌面构建归档后解包到中文/空格安装目录，使用解包 preset 的 baseUrl 加载技能；保留现有开发插件源码依赖链接。初次直接搬走开发 app 时按现有设计缺少相邻 desktop-plugin，已修正测试夹具以明确保留该依赖；这不是独立安装器验收。Windows 遮挡窗口的截图等待问题通过聚焦测试自有窗口处理。
- 同次回归：品牌图片/标题、视觉模型请求、越界写入拒绝、窗口复用、退出后停止 Host、历史 standard 会话恢复、同账号续查/跨账号拒绝均通过。模型是脚本夹具，输出仅证明集成链路，不是法律推理准确率验收。
- 测试产物：`%TEMP%/chengye-desktop-e2e-zLu7jc/`，截图 `lawyer-skills-results.png`，四份报告位于其 `中文案件目录/`。已检查截图及输出文件。
- `verify-source.mjs` 核对 9,267 个导入文件通过。原 C33 standard 的 SHA-256 仍为 f04fbc6ec6d38aab78f18690c293ddcb76293107f7e6cd157904b7c0e83094bd。正式插件 17 个源码/文档/配置文件的凭据模式扫描通过。

LS-01～LS-07 的集成验收通过；真实模型法律质量、真实账号外部检索可用性、干净 Windows 无源码安装器仍按部署 Spec 后续验收。

## 原始参考目录与提交

来源和改编摘要保留在正式 preset 的 SOURCES.md。完成必要参考与验证后尝试清理根 skills 目录，自动审批拒绝删除（仅返回 blocked by policy，未给更具体原因），因此原目录保留、不加入本地提交。未绕过审批更换方式删除或移动。正式包独立运行，不受参考目录保留影响。

仅提交本次 Spec、实现、说明和测试，不推送，不包含临时数据、个人配置或参考资料里的密钥。
