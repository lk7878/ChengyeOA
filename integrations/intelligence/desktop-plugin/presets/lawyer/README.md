# 律师办案助手 preset

复制来源：`third_party/deepseek-harness/packages/preset/agent-presets/presets/standard/agent.cordis.yml`。
复制时源文件 SHA-256：`f04fbc6ec6d38aab78f18690c293ddcb76293107f7e6cd157904b7c0e83094bd`，与只读 C33 原项目一致。

只扩充 persona 并增加独立中文元数据；从 `agent-instructions` 起的全部原生组合逐字保留。升级 Harness 后先对照来源及原生 academic-wiki template，再审查更新本副本，不覆盖用户自建 preset。

`desktop/product.patch.yml` 只装载本目录的父级，关闭原生和用户 preset 目录发现。`desktop/lawyer-presets.mjs` 继承原生注册服务，固定默认值为 lawyer；旧内置标识仅作为恢复别名，统一使用 lawyer 组合，不改写历史日志，不提供额外可选模式。`cloud_wiki` 是正式 Product Profile 装载的独立桌面插件，由律师模式继承。

现阶段联网查询云端 Wiki，没有本地快照同步和离线查询。快照方案见[规格](../../../../../docs/superpowers/specs/2026-09-13-baiyou-lawyer-preset.md)。不通过启用原生可写个人 Wiki 来模拟只读云端同步。
