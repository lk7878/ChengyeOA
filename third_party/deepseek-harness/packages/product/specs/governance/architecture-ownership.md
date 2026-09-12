# 架构、目录与代码所有权

## 逻辑分层

| 层 | 所有者 | 职责 |
|---|---|---|
| 上游基础层 | 官方 Harness | 通用运行时、扩展点和基础能力 |
| 产品能力层 | `packages/product/` | 自定义契约、插件、客户端扩展、Preset 和 Bundle |
| 桌面交付层 | `apps/product-desktop/` | 桌面壳、操作系统集成、安装和交付 |

逻辑分层不要求产品代码散落到 Harness 的既有包组。产品能力集中在 `packages/product/`，通过公开扩展点依赖上游服务定义，不直接依赖具体提供方。

## 目标目录

```text
packages/product/
├─ specs/
│  ├─ feature-map.md
│  └─ Fxxx-feature-name/
├─ product-contracts/
├─ product-runtime/
├─ product-client/
├─ product-skills/
│  └─ skills/
│     └─ <skill-name>/
│        ├─ SKILL.md
│        ├─ references/
│        ├─ scripts/
│        └─ assets/
├─ product-presets/
└─ product-bundle/
   └─ cordis.patch.yml

apps/product-desktop/
```

该目录是目标拓扑，不要求在能力出现之前创建空包。新增包必须具有当前消费者和明确职责；包名与发布命名空间在首次创建可发布包前单独确定。

## 依赖方向

- 契约包不得依赖产品运行时、客户端、Preset 或 Bundle。
- 运行时插件和客户端扩展可以依赖契约及官方 Service Definition，不得依赖具体官方 Provider。
- Preset 和 Bundle 负责组合，不承载业务实现。
- 桌面应用消费产品能力，不成为业务能力的第二实现位置。
- 产品包不得直接依赖 Studio 包；移植后的代码归产品所有并保留必要的来源与许可证记录。
- 二开 Spec、治理规则、迁移记录和产品版本映射由 `packages/product/specs/` 维护；Harness 原生规范不迁入该目录。

## Skill 所有权与装载

- 产品通用 Skill 集中在 `packages/product/product-skills/skills/`，由正式的产品 Skill Provider 随包发布并注册到官方 `ctx.skills`。
- 仅服务于某个 Preset 的 Skill 可以放在 `packages/product/product-presets/` 对应 Preset 的 `skills/` 目录，并在该 Preset 作用域内装载。
- `product-bundle/cordis.patch.yml` 只负责装配产品 Skill Provider，不保存 Skill 内容，也不依赖源码仓库绝对路径。
- 用户或具体项目自行维护的 Skill 继续使用 Harness 的项目和用户 Skill 根目录，不进入产品源码包。
- 产品内置 Skill 作为可覆盖的默认能力；需要强制执行的安全、权限或业务规则必须由插件和运行时校验实现，不能依赖 Skill 指令。
- Skill 包只在首个已批准 Skill 出现时创建，不为目标拓扑建立空包。
