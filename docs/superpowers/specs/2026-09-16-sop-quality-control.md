# SOP 与案件质检增量规格

- ID：SPEC-SOP-QC-20260916
- 日期：2026-09-16
- 状态：分阶段实施；SQ1–SQ6已验收，完整交付待SQ7
- 来源：用户要求继续规划 SOP 和质检；承接已验收 U5–U7，不重开已完成阶段。
- 实施计划：[SQ 阶段计划](../plans/2026-09-16-sop-quality-control.md)

## 1. 产品定位与范围

将 OA 从“共同维护业务数据”扩展为“按专业流程交付、按岗位审核、问题可追踪”。SOP回答当前应完成什么、由谁执行、需要哪些材料；质检回答提交版本是否符合要求、有什么问题、是否完成复核。两者围绕同一业务记录协作。

保持飞书式工作区：左侧表目录，顶部个人/公共视图和字段、筛选、分组、排序工具，中间共同表格，记录详情承接材料、办理、审核和历史。参考飞书官方将工作流与数据表纳入同一目录的交互方式，但节点规则和法律业务责任由本系统规格定义，不以“像飞书”替代事务和权限设计。[飞书工作流说明](https://www.feishu.cn/content/article/7595146589556788441)

本轮规划包括：模板配置和版本发布、实例与任务、材料/报告/专家意见、一级审核、二级抽检、问题整改复核、低满意度专项分析、站内提醒、范围内统计、三个专业团队模板及签约前后衔接。首个业务试点建议医疗纠纷；暂未取得用户试点偏好时按该建议编排，另外两个团队仍在完整计划内。

不并入本轮：任意脚本/BPMN编排器、全新IM、全量满意度问卷平台、自动法律结论、无人审批、自动把案件材料发到外部、重写Wiki/Harness。自动形成站内待办不代表自动对外发送客户告知。Harness主动归档MAT-04B保持独立交付，不作为基本SOP/质检上线的前提。

## 2. 已有能力与必须处理的差异

| 已核对事实 | 本次设计决策 |
| --- | --- |
| ProfessionalTeam/Member、组织/岗位/账号/角色已存在 | 只引用原ID，配置规则引用岗位/角色；运行时解析当前有效任职 |
| Case/CaseTask/CaseFile/Communication及案件范围服务已存在 | Case为唯一案件事实源，不另建可独立维护的Matter副本 |
| CaseTask没有负责人、创建人、独立版本、SOP外键；更新仅支持待办→处理中→完成 | 以增量字段/扩展表承接负责人及SOP关联；旧任务保持原行为，未知创建人不猜测回填，旧API不得绕过新审核规则 |
| CaseFile是案件附件台账，尚无报告版本及审核绑定 | 新增不可变提交版本与材料引用，不能把当前附件集合当历史审核快照；被引用材料禁止物理删除 |
| Case.teamIds为JSON文本，不能直接证明当前团队授权 | 新建实例明确团队锚点和有效人员关系，迁移校验真实团队；不得仅凭teamIds扩大TEAM权限 |
| Case.satisfaction为1–5整数，MOD-008写低于80分 | 保留旧星级；新增独立、标明量表与来源的0–100满意度评估。旧值不乘20、不自动触发历史追责 |
| AnalysisEngagement存在，且依赖分析委托合同；没有完整独立业务工作台 | 初期只接已建案件；签约前受理与分析委托在SQ6明确补齐，不能靠生成虚假Case/Contract承接 |
| MOD-007执行团队9节点；专项字段清单10节点 | 默认模板采用MOD-007九个主节点，财产线索整理归证据收集子任务；专项清单保留映射说明，不同时发布两个互相矛盾的默认版本 |
| 刑事资料默认非强制、医疗不固定工作日SLA | 模板默认提示性检查；硬性门槛只能按团队/案件类型明确配置并发布；不内置法定期限推算 |

主要核对文件：server/prisma/schema.prisma；case-task-service.ts、case-service.ts、case-scope.ts；MOD-007/008；三大专业团队SOP系统字段清单；FTN-005/006；现行WorkspaceEditor、businessSources、导航目录。代码路径相对于LayerManage/law-firm-system/apps。

## 3. 操作闭环

模板草稿→审核发布→在获权案件选择适用版本→实例化节点/任务→分派→收集材料/记录指导→提交报告或节点成果→一级审核→通过或退回→修订版本后复审→节点完成。

二级抽检独立于一级审核：对已结案或已完成的适用交付抽样，形成问题单，记录整改材料并复核。已结案案件可继续质检/整改记录，不重新打开原案件状态、不修改历史财务、不借整改接口更新已封存任务。

满意度专项分析是第三类独立流程：记录触发原因、分析过程、结论和关闭状态。普通质检问题单可要求负责人/整改计划；专项分析不强制固定负责人、整改期限、复查结论或复盘入库。其关闭按FTN-006接原审批/二次确认策略，不能直接勾选完成。

## 4. 页面与同源视图

| 入口（拟新增，不生成空菜单） | 主要内容 | 首批形态 |
| --- | --- | --- |
| 管理中心 / 流程与质检配置 | SOP模板、适用团队/类型、材料要求、审核人规则、抽检/提醒策略、发布历史 | 专用配置页，节点列表排序+依赖设置+流程预览 |
| 业务应用 / 签约交付 / SOP工作台 | 全部获权实例、我的执行任务、我的提交、待审核、逾期 | 共同表格和保存视图；统计遵守访问者范围 |
| 案件详情 / SOP与质检 | 当前模板版本、节点进度、任务、材料、报告、专家意见、质检历史 | 页内专用办理区，保留原案件路径及返回上下文 |
| 业务应用 / 质量管理 | 一级审核、二级抽检、问题整改、专项分析 | 同源目录+公共/个人视图，详情受控提交/审核 |
| 工作台 / 待办与通知 | 指派、退回、复核、到期提醒 | 原通知与审批入口定位原业务ID |
| 数据分析 / 交付质量 | 节点完成、逾期、审核退回、抽检覆盖、问题关闭 | 范围内聚合，空数据与无权限分开 |

建议路由：/sop、/sop/:id、/quality/reviews、/quality/reviews/:id、/quality/issues、/quality/issues/:id、/quality/special-analyses、/admin/sop-templates、/admin/quality-rules。正式实现前补入现有导航目录和路由测试；详情/返回始终使用原ID。

拟接共同来源SOP_INSTANCES、SOP_TASKS、QUALITY_REVIEWS、QUALITY_ISSUES，先交付现有网格能力。字段配置可调整扩展字段与展示，系统状态、审核结论、责任人变更、模板发布等走独立动作；批量粘贴/导入也不能改写受控字段。看板、甘特图、全功能拖拽画布列为可选增强，不作为首批依赖，不能把现有分组视图称为已实现看板。

## 5. 岗位与数据权限

延续用户要求：普通岗位默认仅查看自己登记的业务数据；“负责人可看全部”指其获权团队/组织，跨组织全量须单独授权。个人视图只是筛选，不能授予权限。

为避免“负责人创建的任务员工看不到”，新增任务必须有明确的对象协作授权：获派任务只授予任务必要内容；案件材料仍须独立案件/文件权限。任务指派本身不能扩大整案读取。需要查看关联案件才能执行时，界面提示管理员补齐最小授权或改派；不发送隐藏案件标题/材料正文。该例外独立于SELF创建人范围，授权、撤回与有效期可追溯。

| 岗位 | 可配置动作 | 数据边界 |
| --- | --- | --- |
| 承办人/助理 | 本人任务执行、成果提交、退回修订 | SELF及显式任务协作授权；无审核自己成果权限 |
| 团队负责人 | 分派、团队进度、一级审核、整改复核 | 明确授权的TEAM/ORG及关联记录read交集 |
| 专家 | 获派记录指导、获派一级审核 | 必要对象授权；不能从待办读取未获权附件 |
| 质检岗/管委会 | 抽检、问题登记、复核、专项分析 | 已授权组织/团队范围，检查本人参与的成果须回避 |
| 系统管理员 | 模板/岗位/策略配置 | 配置权不自动等于业务审核权；沿用已有系统身份规则并核对实际动作 |
| 治理审核人 | 高风险模板发布/变更审核 | 原治理角色与职责分离，不得自提自审 |

权限族拟定：sop.template.read/manage/publish、sop.instance.read/start/manage、sop.task.read/assign/update/submit、sop.report.read/submit、sop.guidance.read/create、quality.review.read/assign/decide、quality.sample.manage、quality.issue.read/manage/resolve/verify、quality.analysis.read/manage/close、quality.metric.read，加对应菜单码；SQ1须统一入代码和数据库目录，不默认授予所有业务角色。下载仍须原文件权限。

组织/团队/员工/角色候选分别遵守对应read范围；服务端重新校验有效任职、目标对象及权限。审核人必须是有效获权人且不是本轮提交人，必要时排除本轮实际制作者。无合格审核人进入待分派，不自动通过或回退给系统管理员。离职/调岗/撤权后重新分派并保留历史，不静默完成。

列表、详情、导出、聚合、关联标签、附件、审批摘要及SSE均复验同一授权边界。授权收紧后前端按现有5秒/焦点机制清除不可见记录和草稿，提交仍服务端鉴权。不得把菜单隐藏当作权限实现。

## 6. 数据与版本契约（逻辑模型，非已建表）

| 对象 | 职责与关键约束 |
| --- | --- |
| SopTemplate / SopTemplateVersion | 稳定模板ID+不可变发布版本，适用团队/类型/组织、节点、资料、审核、提醒规则、内容摘要与治理记录 |
| SopInstance / SopNodeInstance | 首期FK到Case，绑定发布版本和明确团队/组织；节点保留模板快照、执行状态与版本 |
| CaseTask增量或SopTask扩展 | 优先复用CaseTask身份，补负责人、创建人、版本和节点关联；两种物理形态由SQ1锁定，禁止两套可分别修改的完成状态 |
| SopSubmission / SubmissionAttachment | 每次提交冻结节点、报告内容、材料版本、摘要、提交人、提交时间；修订创建新版本 |
| ExpertGuidance | 关联案件/节点/来源成果，指导人、时间、内容和附件，指导不等于审核通过 |
| QualityReview | 一级/抽检类型，目标提交版本、检查清单版本、检查结果与原ApprovalInstance链接；不自建第二审批任务系统 |
| QualityIssue / IssueRevision | 来源检查项、发现依据、责任分派、整改提交及复核记录；普通问题与专项分析分离 |
| QualitySamplingRun / SamplingItem | 批次、月份、策略版本、候选快照/摘要、算法版本与种子、被抽对象和排除原因 |
| SatisfactionAssessment / SpecialAnalysis | 0–100分、量表版本、来源证据/日期/录入人；专项分析按评估ID去重，修订关联前版本，不删历史触发事实 |

公共要求：真实createdBy/updatedBy、version、组织/团队锚点和时间；引用原User/Employee/Case/Contract/File ID，不复制可独立变更的主数据。任务指派、审核与材料引用建可靠FK/唯一约束；被历史提交引用的数据用RESTRICT或软删除保留。新表不得被Case旧删除级联清除；对原案件删除服务新增引用保护。

模板已有实例时，停用仅禁止新启用；已发布版本不原地改写。修改生成新版本；回滚通过重新发布历史内容形成新版本，既有实例不自动切换。首次模板发布及结构/强制门槛/权限扩大等高风险变更走原配置治理适配，审核摘要与最终发布内容必须相同。旧实例升级须预览差异、明确节点映射、授权确认与审计；首期不提供批量升级。

## 7. 状态与受控动作

| 对象 | 允许状态和关键规则 |
| --- | --- |
| 模板版本 | DRAFT→IN_REVIEW→PUBLISHED；拒绝回DRAFT；已发布可停用。发布、回滚由治理结果执行，不接受前端任意目标状态 |
| 实例 | ACTIVE↔PAUSED；ACTIVE→COMPLETED；ACTIVE/PAUSED→CANCELLED（原因必填）；完成不自动结案 |
| 节点 | NOT_STARTED→IN_PROGRESS→COMPLETED；配置审核时经IN_REVIEW；退回到CHANGES_REQUESTED→IN_PROGRESS；受控跳过SKIPPED须原因，不伪造材料或完成时间 |
| 提交审核 | PENDING→APPROVED/RETURNED/CANCELLED；退回后必须提交新版本，旧回调不能通过新版本 |
| 问题单 | OPEN→IN_PROGRESS→PENDING_VERIFY→CLOSED；复核失败退回IN_PROGRESS；撤销须依据并保留历史 |
| 专项分析 | OPEN→ANALYZING→PENDING_CLOSE→CLOSED；关闭审核退回ANALYZING，不强制整改期限 |

逾期是dueAt与当前时间及未完成状态计算的标记，不用OVERDUE覆盖执行状态。依赖图必须无环；未配置依赖的节点可并行，排序不等于强制串行。模板未明确强制项时，缺资料显示缺口提示；不得硬编码“所有资料齐全才能继续”。启用门槛只作用于明确节点及模板版本。

已审核通过的提交不可覆写；更换关键材料形成新修订且须重新审核，原通过事实标记为历史版本。取消/暂停与审核回调并发按版本及锁校验。质检默认不阻止原案件结案；如组织配置结案门槛，须发布规则、限定新启用实例并在原closeCase服务强制核验，旧接口同样生效，历史已结案件不追溯阻断。

## 8. 质检规则、抽样和满意度

一级审核默认由团队负责人或获权专家承担，清单检查材料完整性、版本、目标/风险记录和交付质量；清单可配置为通过/不通过/不适用，必要依据按项声明，不由AI自动裁决专业结论。

二级抽检默认按月对上一自然月已结案件执行，时区Asia/Shanghai；管委会在授权范围配置样本数或比例、是否按团队分层。采用记录候选快照、算法/策略版本和随机种子的可复现无放回抽样；同一策略/范围/月批次唯一，重试不重新抽取。候选不足取实际数量，零候选记录空批次。禁止通过反复重跑挑选满意样本；补抽作为独立有原因的追加批次。抽样执行身份必须有明确范围，不能用超级管理员全库抽样再在前端过滤。

满意度低于80采用新0–100量表，79触发、80不触发、空值不触发；不是质检评分。旧1–5星保持原字段和显示，不换算、不重算历史。新录入要求来源、评估日期与证据引用，有版本修订。相同评估事件只创建一个专项分析；后续纠错保留旧触发并记录处理依据，不自动删除问题。正式问卷、复购转介绍全生命周期仍由MOD-009后续覆盖。

## 9. 事务、事件、提醒与错误

启动实例、生成节点/任务、审核决定和问题流转在事务内写事实、版本、OperationLog和Outbox。启动键绑定原对象+发布版本+业务批次；允许重复执行某流程时必须显式新建批次，网络重试复用原requestKey和摘要。409保留草稿，幂等重放仍复核当前权限。

审批沿原ApprovalDefinition/Instance/Task和同步结果链路：QualityReview只保存业务清单与审核目标。只有同一目标版本的有效审批结果可推进领域状态；回调失败显示“同步失败/待重试”，不展示虚假通过。配置治理沿原适配机制扩展，不假定新增类型已被支持。

事件消费者按事件ID及业务唯一键去重，乱序/撤权/离职/暂停重查事实；不可逆业务状态改变必须在事务内，通知/统计可异步。提醒策略限到期前/后与站内消息，默认关闭固定催办频率，显式配置时间和时区；改期后旧定时任务重新检查dueAt/version。只发给当时获权接收人；通知摘要不携带敏感正文，链接仍再鉴权。消息失败进原事件运维台。

统一错误：参数无效400、未登录401、动作无权403、不可见对象按原资源约定404、版本/状态冲突409、依赖/材料门槛失败返回可见范围内的明确原因。错误不得泄漏被隐藏的材料名称或审核人列表。

## 10. 三团队模板与签约前后衔接

医疗九节点按MOD-007；执行九主节点并容纳专项清单子任务；刑事十二节点保持已有编码。模板种子先建草稿，不自动发布、自动分配人员或修改真实案件。报告模板是可维护内容及材料清单，不预置专业结论或通用法定期限。

首个试点只覆盖已有Case可执行的材料/分析/审核交付；案件建立前的客户到访、分析委托、目标对齐、正式签约不倒填成已完成。SQ6补前期SOP上下文：LEAD、ANALYSIS_ENGAGEMENT与CASE以互斥可校验FK定位真实来源，客户/合同只引用。AnalysisEngagement依赖真实分析委托合同，首次接待可关联真实Lead。各来源分别遵守lead.read、合同/分析委托及案件范围，不能用后来关联的案件读取权限解锁此前未获权材料。

转客户、正式签约、建案只能由原业务动作形成真实关联，接续记录保留原实例及其提交历史，不迁改创建人、不复制状态真相。前期任务/材料需独立可授权归属；若现有存储不能满足，SQ6增量实现，不向CaseFile伪造caseId。该部分是完整三团队闭环的必要交付，未完成时不能宣称全部SOP落地。

## 11. 验收编号

| 编号 | 必须验证的结果 |
| --- | --- |
| SQ-AC-01 | 模板草稿/审核/发布/停用/回滚，旧实例版本不漂移，审核人回避，结构变更审批不可绕过 |
| SQ-AC-02 | 案件启动幂等、不重复生成节点/任务；旧任务仍可办理且无法绕过SOP审核；未知创建人保持未知 |
| SQ-AC-03 | 三角色同一表格/个人视图/直链；SELF、显式协作、TEAM/ORG、附件与关联标签范围交集；撤权清除 |
| SQ-AC-04 | 并行节点、配置依赖、非强制资料、按版本强制门槛、暂停/跳过/取消、逾期改期和并发冲突 |
| SQ-AC-05 | 材料/报告版本冻结→提交→退回→新版本→通过；旧回调/材料替换/自审/越权审核均拒绝 |
| SQ-AC-06 | 二级抽样可复现、零候选/候选不足、重复调度不重复抽样、补抽有原因，范围与统计不泄漏 |
| SQ-AC-07 | 问题整改/退回复核/关闭可追溯；已结案件质检不改原生命周期；低满意度专项分析规则不被普通问题约束替代 |
| SQ-AC-08 | 79/80/空分边界、旧星级不转换、事件重复/乱序/故障恢复、专项关闭审批及审计 |
| SQ-AC-09 | 提醒/待办/审批跳原ID；离职撤权、通知重试与改期不会产生旧提醒或暴露正文 |
| SQ-AC-10 | 医疗/执行/刑事各完整正反例；签约前后真源接续，不伪造案件合同，无隐藏的模板硬编码 |
| SQ-AC-11 | 1440/1024/390、键盘焦点、空/加载/失败/离线重试、共享变更、窄屏工具栏；新增菜单真实可用才开放 |
| SQ-AC-12 | 增量迁移和SQL重入不损坏60迁移后的真实数据；原ID、版本、权限与审计保留；按影响做回归/构建/冒烟/容量验收 |

每阶段在隔离测试库执行真实App冒烟（非仅单元测试），失败修复后复验，证据注明夹具、环境、剩余限制。触及协作查询/写入/推送热路径时重跑既有100会话/900秒契约；审批/抽样/提醒另测并发幂等与故障恢复，不能把通用表格负载作为专属业务容量结论。每阶段完成后同步文档并本地Git提交，未经新授权不推送或部署。


## SQ1 实施前补充（2026-09-17）

物理模型锁定：SopTemplate保留稳定ID、code、name、organizationId、professionalTeamId、caseType、createdBy/version；SopTemplateVersion保留templateId、number、content JSON、contentHash、status、version、createdBy和治理发布/停用ID，唯一(templateId,number)，发布内容不可原地修改。模板的activeVersionId只定位已发布版本。SopInstance先提供案件/版本的RESTRICT引用骨架用于删除保护，执行行为在SQ2实现；CaseTask采用增量字段及可空SOP节点FK，保持原任务ID，不新增另一套完成状态。组织和团队用真实FK，创建/读取候选检查独立组织/团队read范围，模板TEAM/ORG/SELF分别取明确锚点及真实创建人。

节点JSON v1：code/name/instruction、dependsOn、materials(code/name/required/instruction)、reviewRequired、reviewerRoleId可空、reminderDays可空、closeGate默认false；1–50节点、每节点最多30材料，引用存在且无环，编号唯一，默认required=false。审核角色若设置须为启用业务角色且创建人可读取，实际人员SQ2/3按生效授权解析。reminderDays为1–365自然日，不暗含法定期限。

API（拟新增）：GET/POST /sop/templates；GET /sop/templates/:id；POST /sop/templates/:id/versions（从指定历史版本复制生成新草稿）；PUT /sop/template-versions/:id（草稿编辑、expectedVersion）；GET /sop/template-options（获权组织/团队及角色候选，分页或明确候选上限）；GET /sop/template-presets（三团队草稿内容，管理员显式选择才保存）。列表分页1–100，keyword/status可选，读操作不建默认模板。所有新建采用持久requestKey+摘要，编辑强制版本。

发布/停用使用原治理operationType SOP_TEMPLATE_PUBLISH / SOP_TEMPLATE_DISABLE，targetType=SOP_TEMPLATE_VERSION、expectedTargetVersion和payload.contentHash；HIGH/PRE，两次MFA遵守原治理流程。请求和执行均复核模板sop.template.publish范围及有效账号，发布检查目标仍为同版本草稿且摘要匹配。治理PENDING_REVIEW/APPROVED/EXECUTING期间显示IN_REVIEW并禁止编辑；拒绝/取消恢复可编辑草稿；失败保留治理记录，可修复后重新申请，旧请求不能通过新版本。回滚是复制历史内容形成新草稿并再次审核发布，不改旧实例。前端模板页请求治理审批并链接原治理详情；通用治理新建表单不把SOP类型误作为用户账户操作。

SQ1新权限仅menu.sop_templates和sop.template.read/manage/publish，resource=sop_template；其余运行权限到对应阶段加入。目录数据库增量与代码同步，不默认授予业务角色；SYSTEM_ADMIN按已有窄目录显式增加模板配置动作，publish仍必须另一超级管理员审核。模板读取/修改仍采用服务端动作+范围；系统身份不授予案件审核。

SQ1验收补充：三团队模板默认均为草稿；错误依赖图/未知字段/组织团队不一致拒绝；草稿编辑409保留UI；发布期间禁止修改、换摘要/自审/撤权拒绝；旧版读取与回滚新版本验证；Case已有SOP引用删除拒绝且保留原关联；迁移/权限目录重入及原治理回归。

SQ1补充只读定位接口：GET /api/v1/sop/template-versions/:id 经sop.template.read及同一模板范围检查后返回所属模板及历史版本，供治理详情准确定位审核目标；不以治理读取权限替代模板范围。版本比较显示新增、移除、配置与排列变化。

## SQ2 实施契约（2026-09-17）

CaseTask增量sopInstanceId/nodeCode/nodeSnapshot/createdBy/updatedBy/assigneeUserId/version，仍为唯一任务身份和状态源；SopInstance业务唯一键(caseId,templateVersionId,batchKey)，原始创建请求另由DomainMutation去重。SopTaskAccess以真实用户/任务/授予人FK记录显式读取及执行授权、有效期、撤销依据。指派必须有employee.read范围且目标当前具有SOP读取和执行权限；任务权限不解锁Case或CaseFile。

本阶段实际权限为menu.sop_tasks、sop.instance.read/start/manage、sop.task.read/execute/manage。对应资源sop_instance/sop_task，SELF取真实创建人，ORG/TEAM取绑定模板组织/团队；读取与执行并入有效对象授权。共同来源SOP_TASKS的工作区SELF限制也包含这一显式任务例外，同时与工作区组织和业务任务范围求交。原始同源行保持CaseTask ID，无CollabRecord副本。

实际页面为/sop/tasks共同工作表、/sop/tasks/:id办理、/sop/instances/new启动与/sop/instances/:id实例进度；原案件详情提供启动/办理入口。共用视图、字段及个人“分派给我”筛选。案件详情的SOP任务也复验独立task.read，旧CaseTask更新拒绝SOP节点；系统受控动作通过expectedVersion/requestKey办理。逾期与状态组合取交集，逾期不覆写执行状态。已配置强制材料或审核的完成动作在SQ3提供成果提交前保持拒绝。

启动要求原案件读/任务管理、模板读及实例启动范围，以及发布生效版本、组织/团队/类型匹配；冻结节点内容不随模板变化。开始/完成检查依赖，实例暂停、取消或案件终态均不可继续。改派撤销旧对象授权；普通获派者不能改派、跳过或管理实例。列表、详情、错误清除和5秒/焦点刷新沿统一范围约束。

## SQ3 实施补充（已验收）

新增SopSubmission、SubmissionAttachment、QualityReview、ExpertGuidance四个物理表，CaseTask.activeSubmissionId指向当前修订；唯一(taskId,number)、唯一review.submissionId及approvalInstanceId，材料和人员引用使用RESTRICT外键。CaseFile原ID是不可变材料版本，提交冻结真实文件SHA-256/大小/资料项；审批同步同时核验引用集合、文件字节、提交摘要、当前节点版本及状态。

审核沿原ApprovalInstance/Task，新增SOP_REVIEW业务类型和业务同步目标。可信提交适配器在同一事务创建本轮私有审核定义与实例；通用申请、定义编辑/导入/停用不能伪造或修改SOP审核。回避提交人和本轮执行人，复核冻结候选角色、有效账号/任职、独立审核及文件权限；无审核人保留WAITING_ASSIGNMENT。转交/加签首期不开放，需退回/撤回再修订。审核检查清单在决定时冻结摘要；原审批已定稿后清单不得编辑。原同步台账FAILED可重试，但只接受仍获权且版本/材料未变化的目标。

实际新增权限sop.report.read/submit、sop.guidance.read/create、quality.review.read/assign/decide均以sop_task为资源范围。报告/指导还需task.read交集；已有显式任务授权可用于必要报告/指导动作，但材料清单、文件名和下载始终独立case.file.read。无审核范围的报告读者不获得检查意见及原审批明细入口。原审批列表/详情/导出/统计/同步台账也与SOP范围求交。

提交接口与SQ3开工契约一致，补GET /sop/tasks/:id/material-options分页100、POST /sop/reviews/:id/checklist（expectedVersion，材料及成果检查项PASS/FAIL/NA，后两者依据必填）。新页面/sop/submissions/:id承接不可变报告、冻结材料、清单与原审批深链/approvals?instance=原ID；任务页承接提交及专家指导。原closeCase只检查绑定模板closeGate=true、未取消实例的节点真实COMPLETED，跳过不算通过，默认模板和旧案件不增加门槛。

成果材料下载为GET /sop/submissions/:id/materials/:fileId，独立校验task/report及case.file.read后核验冻结SHA-256，不通过当前文件替换历史版本。指导创建写入sop.guidance.created事务事件；检查清单最终审批时冻结到原审批内容与摘要。候选人员首期最多500人，材料候选每页100条。


## SQ4 实施契约

新增QualitySamplingPolicy不可变版本，QualitySamplingRun唯一(policyId,scopeHash,month,batchKey)，QualitySamplingItem绑定原Case作为二级事实检查，QualityIssue/IssueRevision/IssueAttachment承接独立整改历史。一级SopSubmission的批准继续由SQ3 QualityReview/原审批承接；二级观察不改写一级批准事实。检查清单固定在样本，完成后不可覆写，FAIL项生成唯一(inspectionId,checkCode)问题。

月度边界为Asia/Shanghai自然月，默认上月，限定策略组织/可选团队与当前case.read/sample.manage范围。候选快照保留Case ID、closedAt、version及唯一分层归属；HASH_SORT_V1以SHA-256(seed + ':' + caseId)排序取无放回样本。多团队案件按排序首个团队归层，未知归组单独层；按层COUNT/RATIO，比例向上取整。范围摘要只取规范化授权目标、不包含求值时间。同批并发返回已存在批次，补抽必须先有PRIMARY和原因，排除历史已抽对象；当前范围收紧后批次详情裁剪候选/排除和检查项，不再返回完整候选摘要。

新增权限menu.quality、quality.sample.read/manage、quality.inspection.read/record、quality.issue.read/manage/resolve/verify。业务资源为case，均与case.read求交；策略按创建人及明确组织/团队锚点限定。负责人候选需独立employee.read及本人当前案件/整改权限；不因分派扩张案件读取。检查人回避案件主办及已提交成果作者/执行人；整改复核回避负责人和本轮提交人。所有写入expectedVersion/requestKey、行锁、实际操作者审计及quality.changed事务事件。

新增/已实现页面：admin/quality-rules策略版本、quality/runs批次、quality/reviews二级共同表、quality/issues整改共同表及原ID详情。QUALITY_REVIEWS投影SamplingItem，QUALITY_ISSUES投影Issue，无CollabRecord镜像，系统状态不可经字段编辑绕过受控动作。

已结案件整改可在SUBMIT中上传材料，但仍需独立case.file.manage，新增CaseFile并立即冻结引用；旧文件不覆盖，引用文件禁止删除。此入口不更新Case/Task/财务状态和版本；普通案件文件接口继续拒绝终态写入。单文件10MB、每次10个，失败事务清理确定未提交的本次文件，不删除提交结果不明的字节。历史下载重新核验文件范围与摘要。


SQ5已按阶段计划验收，百分制评估/专项关闭审批/站内提醒/范围统计已落地，旧星级不变。SQ6的真源上下文、节点选择、独立前期材料及接续契约见[SQ阶段计划](../plans/2026-09-16-sop-quality-control.md#sq6-开工契约)，实现前期部分前仍不宣称完整三团队闭环。


## SQ6 实施契约（2026-09-17）

112模型、67迁移。SopInstance具有互斥CASE/LEAD/ANALYSIS_ENGAGEMENT真实FK，CaseTask继续使用原ID和单一状态；前期任务caseId可空但必须有SOP实例。数据库校验任务来源、材料来源和实例来源不可迁改。新增SopSourceFile归属原前期实例；SubmissionAttachment只引用CaseFile或SourceFile其中一种并冻结SHA-256，不复制文件、不补造案件。

启动API接受caseId/leadId/analysisEngagementId之一与nodeCodes。旧CASE省略nodeCodes保持全节点和原幂等请求摘要；前期必须明确选择且包含依赖闭包。同一来源、模板版本、batchKey不能以不同节点集合重开。GET /sop/source-context解析当前获权原业务来源（含contractId→真实分析委托），不创建客户或合同。线索入口须lead.read/update，分析委托须contract.read，案件须case.read/task.manage，另与SOP启动/管理范围求交。

前期材料GET/POST /sop/tasks/:id/source-materials及GET /:fileId，独立sop.material.read/manage作用于sop_task并与当前lead/contract读取范围求交。显式节点协作不能扩大来源范围；新增文件不可覆盖/删除，单个1字节至10MB，列表每页100。后来的case.file.read不能解锁原前期文件。原成果提交和原SOP_REVIEW审批继续复验冻结材料字节与当前权限。

SopContinuation记录双方原实例、版本和依据；GET /sop/instances/:id/continuations、/continuation-options，POST /continuations。只接受真实客户相同、组织/团队相符的LEAD→分析委托/CASE或分析委托→CASE；后者核验正式合同的分析委托来源。客户转换、合同签署/生效和建案沿原服务。候选先按客户/团队/组织缩小，再取最近100个，并逐个复验双方权限；历史链接只向同时获权者显示。关联不改变原任务、成果或材料，也不自动完成节点。409保留依据，刷新从服务器读取双方当前版本。

医疗/执行/刑事完整九/九/十二节点通过真实前期与案件接续验证，三套均含退回重提；刑事资料默认非强制。范围内质量指标中的“案件SOP节点”只计案件来源，前期任务统计在同源SOP任务工作表查看，避免混淆口径。
