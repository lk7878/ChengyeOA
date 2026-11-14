# 法律技能来源与改编记录

2026-09-14；正式技能包 1.0.0。用户提供的根 skills 目录仅供参考，不作为生产依赖。以下 SHA-256 仅供追溯，不包含源文件凭据。

| 参考目录 | 原 SKILL.md SHA-256 | 采用与重写 |
| --- | --- | --- |
| contract-review-pro | 50e9f6b859b7984092c9a2d8b3ffbb522a68f22068711fb9545f94ad362fecae | 参考条款风险/缺失/对比的能力划分，独立编写任务步骤与报告。移除收费宣传、固定评分、未经核验条号和配置元数据 |
| litigation-response | 2bb873d0467d50957870354a06d8ccbe06f7eee3ff12e276867bf5d1d6f88e9f | 仅参考应诉/争点/证据分析方法，未声明许可的长文及模板不复制；新增主张/事实分层和期限缺失处理 |
| litigation-jurisdiction | f3b83ef80d62896d0c4a69881309c295e3b52bd6efa19b499b269e1b8037f672 | 仅参考管辖分析方法，独立写模板和官方索引；不复制旧省份金额表，补充级别与集中管辖核验 |
| china-legal-query | 95fb846aa6e0fd42485e33658011a90bbf28261c513df19e38f28b07375c445e | 参考官方来源检索思路，改用原生工具和云端 Wiki；不复制凭据、Python 实现或环境安装步骤 |
| tavily-web-search | 1744fd22d0e37f53ea852012f9e4290d492196bb6289065c0487c09cfdaa5be9 | 仅参考查询组织与失败处理方法，并入 china-legal-query；不复制缓存和供应商专用脚本，不新增独立技能 |

正式内容为本项目改编与独立编写，不将参考包未核实的许可标注推广到整个技能包。无上游 Harness 源码改动。其他 21 个参考目录不启用。

接口参考：[官方插件开发](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)、[Build a tool](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)、[官方 Skills 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)。实际遵循本项目导入版本的 skill-filesystem/tool-skill/tool-web 与 cordis preset 示例。
