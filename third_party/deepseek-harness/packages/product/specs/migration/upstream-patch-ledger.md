# 上游修改台账

产品默认通过官方扩展点实现能力。本表只记录无法通过现有扩展点完成、且已经批准的最小上游修改。

| Patch ID | Feature ID | 上游位置 | 必要性 | 替代方案 | 产品提交 | 最近验证基线 | 状态 |
|---|---|---|---|---|---|---|---|
| GOV-001 | 治理基线 | `scripts/verify-subsystem-pages.ts` | 建立空产品所有权目录时尚无可记录的运行时 subsystem | 提前创建没有实现对象的 subsystem 文档；推迟建立产品目录 | 引入 `f5b5f91addfcff9f76b21fc65922e74dae6746bf`；移除 `95c3a906173333d83dcc604b56eeaf15ff033930` | `0a53fb55bea101816fa226bb964ae2bed71c343b` | 已退役；F001 子系统页已建立，产品组恢复常规门禁 |
| GOV-002 | 治理基线 | `scripts/translation-pairing.manifest.json` | 二开 Spec 是中文维护的私有规划与状态记录，不属于发布给 Harness 用户的双语文档 | 为全部规划记录长期维护英文副本；继续使用独立 Spec 仓库 | 待本次提交回填 | `de7a38d80872e54a8ba9ea4093f2d8183a6401d8` | 已批准；目录仍接受 Markdown 链接和格式检查，仅豁免双语配对 |
| GOV-003 | 治理基线 | `tsdown.config.ts` | 根构建器默认把 `packages/*/*` 的每个一级目录当成运行时工作区，而 `packages/product/specs/` 是用户指定的纯文档所有权目录 | 把 Spec 放进具体运行时包；建立没有运行时消费者的伪 npm 包 | 待本次提交回填 | `de7a38d80872e54a8ba9ea4093f2d8183a6401d8` | 已批准；只从 tsdown 工作区发现中排除精确目录，不改变 npm 工作区或 Harness 原生 Spec |

每次上游升级必须逐项确认这些修改仍然必要。官方提供等价扩展点后，应优先移除本地修改。
# 上游补丁登记

## UP-001 `main.page` 原生主页面扩展缝

- Feature：F001
- 状态：已实施并通过定向验证
- 产品提交：`5c77cdb99dcd55d0864f547515000a3bfc359f08`
- 上游基线：`0a53fb55bea101816fa226bb964ae2bed71c343b`
- 所有者：官方层 `packages/client/ui-layout`
- 原因：当前 Slot 只有 Session-scoped `conversation.view`，无法承载独立于 Session 的产品主页面。
- 最小变更：新增 root-scoped keyed `main.page`、页面选择快照和 `ctx.layout.openPrimaryPage/closePrimaryPage`；AppFrame 在主页面激活时以其替换 center/details 展示。
- 产品边界：知识库页面和全部业务逻辑仍在 `packages/product/`。
- 升级处理：上游合并独立分支重放，运行 ui-layout、Slot catalog 和产品 Profile 验证；若上游出现等价契约则迁移后删除本补丁。
