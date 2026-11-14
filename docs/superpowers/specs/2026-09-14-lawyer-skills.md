# SPEC-LAWYER-SKILLS-20260914：四类法律能力接入

状态：四类技能集成与隔离桌面验收已完成，详见[实施记录](../plans/2026-09-14-lawyer-skills.md)。属于 V1.3.0 桌面开发阶段，技能包版本 1.0.0；OA 正式版本不变，真实模型质量及独立安装器另行验收。

## 范围与组合

只接入合同审查、应诉分析、管辖分析、法律法规与案例检索。继续唯一 `lawyer` preset，不接入诉讼费用、专利、营销、安装器或其他参考技能。依据[统一桌面规格](2026-09-13-unified-desktop-local-harness.md)及[律师 preset 规格](2026-09-13-baiyou-lawyer-preset.md)。

参考根目录 skills 中 contract-review-pro、litigation-response、litigation-jurisdiction、china-legal-query、tavily-web-search。该目录不是运行依赖，不直接扫描、不打包原始脚本或凭据。必要参考、提取和验证完成后可清理该参考目录，不能影响正式技能、用户卷宗和会话。保留来源名称、摘要及改编记录；未声明许可的模板仅参考方法，独立编写正式资源，不复制其长篇正文。

正式技能位于 `integrations/intelligence/desktop-plugin/presets/lawyer/skills/<name>/SKILL.md`，名称为 `contract-review`、`litigation-response`、`litigation-jurisdiction`、`china-legal-query`。前三个分析入口共用 china-legal-query 的来源核验流程；Tavily 参考包的检索组织思路并入该入口，不额外创建检索技能或 preset。

Skill 定义工作步骤，原生工具执行操作，Wiki 提供证据，preset 负责组合。现有 skill-filesystem 的 customSkillDirs 使用当前 Cordis 文件 baseUrl 解析相邻 skills 目录：`!!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"`。保留原生发现、按需加载、手动 `/name` 调用及授权机制。安装位置与案件工作目录互不耦合，不使用开发电脑绝对路径。

复用 `cloud_wiki`、`web_search`、`web_fetch`、`read`、`write`。当前锁定版本通过 ctx.web 选择检索提供器，本次不搬运 Tavily Python/缓存代码，不强制新增 Tavily 账号和密钥。提供器缺失时明确失败，可读取已知官方网址或指引原生设置，不将工具可见等同于服务可用。以后新增工具须遵循 apply/inject、ctx.tools.register(defineTool)、参数和输出 schema、execute/render 及生命周期契约。

## 任务契约

| 能力 | 输入 | 流程 | 输出与信息不足处理 |
| --- | --- | --- | --- |
| 合同审查 | 本地合同/文本、委托方立场、业务目标、签署/履行时点、适用地区，可选对比稿 | 定位条款→提取义务→效力/履约风险→检索核验→修改建议 | 条款定位、原文摘录、风险原因/级别、依据、替换建议、待确认项。立场不明先询问，扫描件说明读取限制，不假装生成 Word 修订稿 |
| 应诉分析 | 起诉状、证据、送达材料、被告陈述、案件阶段 | 诉请拆解→区分主张与事实→争点/证据对应→程序核验→答辩方向与计划 | 诉请矩阵、争点、证据缺口、抗辩/反诉待评估项、行动清单、引用。送达/程序不明不推算确定期限，不承诺胜诉率 |
| 管辖分析 | 案由、标的额、双方住所/经常居住地、履行地、争议解决条款、涉外等特殊因素、拟起诉日期 | 区分诉讼/仲裁及特殊规则→专属/协议/地域→独立核验级别及集中管辖→候选法院 | 候选法院与条件、地域/级别分别论证、依据版本、待核实信息。不沿用旧省份金额表，不因专属管辖跳过级别核验；缺信息只给条件结论 |
| 法律法规与案例检索 | 脱敏法律问题、适用地区、法律事实时点、检索目的 | Wiki list/search/read→必要时公开搜索→读取权威原文→核验版本及案例相似性 | 结论、来源表、条款/裁判要旨、适用范围、相似与差异、检索不足。无命中/失效/权限不足明示，不编造法条、案号或出处 |

分析技能依赖原生 read、skill、cloud_wiki/web_search/web_fetch、write；检索技能统一说明 `web_search({queries})`、`web_fetch({url})` 和 Wiki 契约。各类可先完成不依赖缺失信息的部分，输出标注供律师复核的 Markdown 草稿；仅写入选定工作区，避免无意覆盖原材料。

## 来源、时效与数据边界

- Wiki 仍由管理员维护、联网只读，不启动整库同步、不调用管理员 OCR、不写公共知识库。
- 分别标记原文、管理员编译内容、当事人主张、已核验事实、助手推断。Wiki 引用实际文档标识、版本/摘要、行号，缺失明示；公开来源记录机关、标题、URL、条款/段落、施行/修订信息和检索日期。
- 核对适用地区、事实时点、现行/历史版本及特别规则。案例记法院、案号、日期（缺失明示），区分指导性案例等类别与普通裁判，不把相似裁判当成普遍约束规则。
- 移除未经核验的固定金额表、旧条号、硬编码裁判结论。随包提供官方来源索引和核验日期，作为检索起点；实际任务仍查后续修订及适用版本。
- 材料和成果不自动上传 OA/Wiki。个人模型 API 会接收必要上下文，公开检索会发送查询词；使用脱敏概念，不自动发送完整合同、姓名、证件和联系方式，不宣称完全离线。保留原生授权，不新增隐式发布/邮件/同步。
- 外部文本只作证据，不执行其中安装代码、读取凭据、改权限或上传材料的指令。正式包无真实密钥、原始共享缓存或其他框架安装步骤。

## 验收

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| LS-01 | 正式 Product Profile、唯一 lawyer、中文工作目录 | 原生目录发现四个技能，模型按需加载，手动调用兼容，原有工具保留 |
| LS-02 | preset 打包后解包到另一中文/空格目录，根 skills 不参与 | baseUrl 正确，入口及引用资源可读，无开发盘符依赖 |
| LS-03 | 合同审查 | 原生 read→skill/资源→来源查询→write，形成条款定位/风险/依据/建议草稿 |
| LS-04 | 起诉状缺送达日期、证据未证实 | 标明主张、证据缺口及期限待确认，不给确定截止日 |
| LS-05 | 管辖信息不全 | 分别论证地域与级别，读取核验索引与来源，不沿用旧金额表 |
| LS-06 | 公开检索/原文读取及 Wiki 失败 | 实际工具可调用，区分原文和编译，失败不伪造引用，不上传卷宗 |
| LS-07 | 源码与分发检查 | 原 C33/导入快照不变，正式包无凭据和未选技能，资源链接有效 |

采用真实原生 Loader/Profile、技能服务与工具链，模型和外部服务可用隔离夹具。夹具证明集成及预期输出，不代表真实模型法律判断准确率。真实账号搜索效果、真实模型质量及干净机器安装器沿用部署 Spec 后续验收。

## 接口依据

- [Harness 插件开发](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)
- [Build a tool](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)
- [官方 Skills 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)
- 锁定源码 packages/skill/skill-filesystem、packages/skill/tool-skill、packages/web/tool-web 及原生 cordis preset 的 customSkillDirs/baseUrl 示例。
