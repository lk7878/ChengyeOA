# 律师办案助手 preset

复制来源：`third_party/deepseek-harness/packages/preset/agent-presets/presets/standard/agent.cordis.yml`。
复制时源文件 SHA-256：`f04fbc6ec6d38aab78f18690c293ddcb76293107f7e6cd157904b7c0e83094bd`，与只读 C33 原项目一致。

扩充 persona、独立中文元数据及 skill-filesystem 的 customSkillDirs；其他原生组合保留。升级 Harness 后对照来源及原生 cordis/academic-wiki template，审查更新本副本，不覆盖用户自建 preset。

`desktop/product.patch.yml` 只装载本目录的父级，关闭原生和用户 preset 目录发现。`desktop/lawyer-presets.mjs` 继承原生注册服务，固定默认值为 lawyer；旧内置标识仅作为恢复别名，统一使用 lawyer 组合，不改写历史日志，不提供额外可选模式。`cloud_wiki` 是正式 Product Profile 装载的独立桌面插件，由律师模式继承。

现阶段联网查询云端 Wiki，没有本地快照同步和离线查询。快照方案见[规格](../../../../../docs/superpowers/specs/2026-09-13-baiyou-lawyer-preset.md)。不通过启用原生可写个人 Wiki 来模拟只读云端同步。

## 四类法律技能（1.0.0）

依据[法律技能 Spec](../../../../../docs/superpowers/specs/2026-09-14-lawyer-skills.md)，本目录的 skills 包含 contract-review、litigation-response、litigation-jurisdiction、china-legal-query。引用模板放在各自 references 内。可以自然语言提出任务，或使用 `/contract-review` 等原生入口；其他分析任务共用 china-legal-query，按需加载，不增加 preset。

customSkillDirs 通过 Cordis 的 baseUrl 解析本目录，沿用上游 cordis preset 示例；desktop:build 将 preset 连同技能复制到 dist/desktop/presets，并指向这份构建副本。修改技能后重新 build，运行中的客户端退出重启。npm 包 files 同时包含 presets，不能只复制 agent.cordis.yml 而遗漏技能资源。构建仍依赖导入 Harness 与本地运行时，不是独立安装包。

检索复用原生 web_search/web_fetch 和既有 cloud_wiki。当前 Product 的公开搜索提供器是 deepseek-official，使用原生凭据配置；搜索 Endpoint 与聊天 Endpoint 分开配置。没有引入 Tavily API/Python，不携带或寻找参考资料密钥。真实服务可用性由用户配置决定，失败会标明，技能不会自动改配置。

来源核验索引记录了 2026-09-14 查阅的官方规则，实际办案仍需核验时点、地区和后续变更。Skill 是模型工作指导，不是确定性法律规则引擎或额外的文件权限隔离层。

来源与取舍见 [SOURCES.md](SOURCES.md)。根目录的原始 skills 不参与运行和打包。
