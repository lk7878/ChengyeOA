# SOP 与质检交付验收

依据：[规格](../specs/2026-09-16-sop-quality-control.md)、[阶段计划](../plans/2026-09-16-sop-quality-control.md)。人工步骤见[四岗位试用清单](2026-09-17-sop-quality-manual-test.md)。

## 验收追溯

代码、测试路径相对于`LayerManage/law-firm-system/apps/server`。界面冒烟使用真实App、真实HTTP和两个隔离PostgreSQL数据库；测试夹具不写入开发业务库。各阶段日志、截图、负载JSON在`LayerManage/law-firm-system/var/collaboration-evidence/sq1`至`sq7`，不将生成物全部纳入Git。

| 条目 | 实现落点 | 验证证据 |
| --- | --- | --- |
| SQ-AC-01 模板治理 | application/sop/template-service、原SopTemplateAdapter、SopTemplates页面 | test/sop/template-service.test.ts；SQ1真实App发布/停用/复制回滚、MFA/自审/撤权/409 |
| SQ-AC-02 唯一任务 | 原CaseTask与SopInstance、execution-service、原CaseTaskService保护 | test/sop/execution-service.test.ts；原案件回归；SQ2共同表冒烟；SQ7迁移演练旧ID不变 |
| SQ-AC-03 权限交集 | execution-scope、employment-stamp、原同源适配器、独立材料访问 | SOP/质检服务范围测试；SQ2/3/4/5/6多角色真实App和撤权清除；无CollabRecord副本 |
| SQ-AC-04 节点状态 | 冻结nodeSnapshot、依赖、实例与任务版本动作 | execution-service.test.ts；source-context.test.ts依赖闭包/并发接续；SQ2及SQ6冲突草稿 |
| SQ-AC-05 一级审核 | submission-service、review-policy、原ApprovalInstance/Sync | submission-service.test.ts；SQ3真实材料、报告修订、退回/通过/断网/409；源文件篡改同步失败 |
| SQ-AC-06 二级抽样 | QualitySamplingPolicy/Run/Item、QualityService | quality-service.test.ts可复现、同批并发、零/不足/补抽；SQ4真实App批次和检查 |
| SQ-AC-07 整改闭环 | QualityIssue/IssueRevision/IssueAttachment | quality-service.test.ts整改退回重提/材料冻结/自审/已结案件不变；SQ4真实App |
| SQ-AC-08 满意度专项 | SatisfactionAssessment/SpecialAnalysis、原QUALITY_ANALYSIS审批 | analysis-service.test.ts的79/80/null、旧星级、乱序/重试/关闭；SQ5真实App |
| SQ-AC-09 通知/指标 | 原事件管线、SopReminderScanner、原审批超时扫描、quality metrics | execution/quality/analysis服务测试和notification-target测试；改期、调岗、撤权、失权分页跳过和当前范围 |
| SQ-AC-10 三团队真源 | source-context/source-file/continuation服务、真实原CRM/合同/案件服务 | source-context.test.ts三套完整九/九/十二节点，均退回重提；SQ6真实App从线索经原合同到案件接续 |
| SQ-AC-11 界面/故障 | 同源共同表、SOP/Quality办理页与统一导航 | SQ1–SQ6真实App1440/1024/390截图；离线、409、双会话、撤权；SQ6键盘Enter与版本刷新 |
| SQ-AC-12 升级/保护 | 7个增量迁移、原业务/API保护、112模型目录 | 各阶段开发库计数比对及重复deploy；SQ7 migration-rehearsal基线60→67、fresh67、重复deploy、旧对象逐字段比较；两端检查/构建与受影响回归 |

## 迁移与运行原则

生产式升级使用`prisma migrate deploy`，不使用`migrate dev/reset`；7个增量迁移没有按猜测填充旧创建人、团队或SOP完成状态。重复部署由迁移台账判断，不把重复执行裸DDL当作重入策略。没有自动导入真实SOP模板、实例、策略、样本或专项。

`test/sop/migration-rehearsal.test.ts`需显式`SOP_MIGRATION_REHEARSAL=true`和`DATABASE_URL_TEST`指向以`_test`结尾的PostgreSQL数据库。它只创建随机`sq7_` schema，演练结束删除这些schema，不清空public或开发库。此测试不能连接开发业务库。

在`apps/server`目录、Node 22及依赖已安装时，设置好本地测试库环境变量后可执行：

```powershell
$env:SOP_MIGRATION_REHEARSAL = 'true'
node --import tsx --test --test-concurrency=1 test/sop/migration-rehearsal.test.ts
```

不配置演练开关时，该耗时集成测试明确标为跳过；跳过不计作迁移通过。数据库连接由本地环境提供，不写入文档或Git。

## 交付边界

1. 已实现的是可配置模板、受控任务/成果/审批、独立抽检整改和专项分析，不包含任意脚本/BPMN画布或全功能看板/甘特图。
2. 前期接续是原实例之间的事实关联。依赖校验在单实例的冻结节点内，不能把旧阶段任务复制为新阶段的已完成节点；跨阶段业务动作沿原转换、签约和建案服务办理。
3. 抽检和专项分析不修改旧案件生命周期。旧星级不自动换成百分制，低分更正不删除旧触发事实。
4. 首期审核候选最多500、接续候选最近100、材料每页100。质量指标“案件SOP节点”只计案件来源；前期任务使用SOP共同表查询。
5. 100会话/900秒是注明CPU亲和性、Node/PG、同机回环和进程条件的通用协作负载。默认CPU调度限制仍保留，不能外推真实多设备或SOP/抽样专属大规模容量。
6. Wiki/Harness沿用原边界；MAT-04B主动归档、自动法律结论和对外通知未并入SQ范围。
7. 当前模板维护节点说明、材料清单和审核要求，报告通过正文及真实附件提交；专业Word文书模板库、模拟法庭、罪名库和品牌素材自动沉淀不因SOP节点已实现而被标为完成。

## SQ7 最终运行记录（2026-09-17）

SQ1–SQ6已验收并本地提交；SQ7整体验收通过，SOP与质检七阶段交付完成。

- 真实App全回归20个子场景：首轮19通过、1项共同表冲突复核按钮在抽屉自动滚动/刷新时被重建导致点击超时；改为键盘Enter确认并等待冲突面板隐藏后单独复验1/1通过，全链路等价于20/20。覆盖统一导航、云盘、快捷入口、U4–U6各业务、模板治理、SOP任务/成果/审核、抽检整改、专项分析及前期接续，1440/1024/390无页面横向溢出。
- 受影响服务回归457项：455通过；其余两项非功能回归——可观测性演练负载测试要求专用演练环境（rehearse:event-observability的数据库/开关守卫，与SQ无关）；事件运维订阅断言因SQ5新增4个SOP/质检订阅使目录由3增至7，更新断言后该文件14/14通过。
- 桌面保护：真实Electron原生技能、目录选择、云Wiki IPC/HTTP/服务引用、视觉图片请求、读写、窗口恢复、重启持久化与跨账号知识库隔离均通过（smoke PASS）；桌面权限策略单测12/12通过；Harness源码完整性核验9267个文件通过。
- 迁移演练（opt-in，随机_test schema）：基线60→67、全新67及重复deploy通过，112模型；历史案件/任务/身份/1–5星逐字段不变，无新增真实业务种子。开发库66→67、重复deploy无待执行；16类业务数量[6,1,2,1,7,0,0,0,0,0,0,0,0,0,0,0]与授权数量[2,8,1,29]保持，5个未知组织案件保持。
- 前端69文件304项通过；后端与OA前端构建、两端lint/typecheck、baseline/bootstrap、文档泄漏与diff空白检查通过。通用100会话/900秒负载于SQ6已通过（3600/3600写入、0未观察更新），SQ7未改热路径不重复。

执行环境说明：SQ7收尾期间模型切换使执行沙箱收紧为仅写工作区源码、拒绝gitignore运行时目录（logs/run/node_modules/.vite-temp/var），最后两项复验以升级文件权限完成；未改变代码、数据库或提交内容，也不影响此前已记录的全部结果。
