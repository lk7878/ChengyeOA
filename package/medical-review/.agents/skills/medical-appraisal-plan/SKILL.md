---
name: medical-appraisal-plan
description: >
  医疗损害鉴定主规划。用户说「进行医疗损害鉴定」「写病历分析报告」「过错」
  「原因力」「损害后果」「伤残」「死因推定」时必须首先加载一次。已加载则禁止
  再加载。fill_report 每次调用只写一章，七章必须同轮并行发出。不要出鉴定咨询意见书。
---

# 医疗损害鉴定规划（先加载一次）

本轮若尚未加载本文件，第一个工具调用必须是 `skill(medical-appraisal-plan)`。任一 skill 已出现 `<skill_content>` 后**禁止再调**该 skill。任务清单由系统按工具自动勾选（A→B→C→D），不必反复 `todo_write`。用户问「目前进展」时读 `reports/review/progress.md` 短答，然后继续原波次，不要停下来等用户。思考过程会追加到 `reports/review/thinking.md`。

鉴定质量优先于赶速度：没有关键页原文、没有适用范围内的应然方案、notes 未写清分项过错与机制，不得出件。

## 波次（能并行必须并行）

| 波次 | 同轮并行 | 做什么 | 不要做 |
|------|----------|--------|--------|
| A 解析 | `medical-record-parse` | `parse_records` 立刻返回，OCR 后台跑（简单页 qwen3.5-flash，复杂页 gemini-3.1-flash-lite-image，API并发≤40）；对话保持；完成后 job 通知再进 B；已有 done 则复用 | 前台死等 OCR、用户一说话就中断解析、反复 status、读 pages/、聊天模型识图、subagent 分段 OCR、inspect_file、convert_file、web_fetch 本地路径、job_output wait 空等 |
| B 读事实 | 并行 Read `catalog.md` `timeline.md` `meta.md` | 只读这三份；解析刚完成时本轮必须立刻做；用户要求跳过解析时从本波次开始 | 再加载 parse skill；只回复「解析完成」就停；跳过解析时仍去 parse_records |
| C 审查 | 同轮：`medical-record-review` + `medical-fault-causation` + `damage-consequence` + `disease-appraisal-guidelines` + **`weknora_clinical` + `expected_care_plan`（本波次第一组检索）**；波次 B 已能判断专科时，把对应专科 skill 一并同轮加载 | 先取关键页，再应然，再对照 | 未读医嘱/手术/知情/评分原文就定过错；用 weknora_search / web_search 查临床指南；四个专科连开 |
| D 出件 | 先 `medical-report-writing`，返回后再并行 7 次 `fill_report` | 各章按该 skill 全文骨架写；齐后 `export_md_to_word` | notes 未齐就出件；跳过写作 skill；与 fill_report 同轮并行加载它；一次调用塞七章；自拟小节；用 convert_file 转报告 |

过程只写一份 `reports/review/notes.md`。默认不要加载 `opinion-writing`。波次 D 必须加载一次 `medical-report-writing`。复杂（多院、死亡、多过错叠加、原因力）切 glm-5.3 / gemini-3.8-flash / deepseek-v4-pro-0813。

## 还加载什么（一张表）

| 何时 | 加载一次 | 仍禁止 |
|------|----------|--------|
| 波次 C 已读到主诊断/术式 | `disease-appraisal-guidelines`（只选路）→ 命中则再进 `surgical` / `obstetric` / `emergency` / `orthopedic` **之一** | 四个专科连开；对不上 21 类仍硬套专科；把书内典型原因力写入本案 |
| 死亡案（死亡记录 / 诊断 / 讨论 / 尸检任一） | `autopsy-guidance` | 非死亡加载它 |
| 用户点名类案 / 相似案例 | `case-recommendation`（`weknora_cases` 仍最多 1 次，未中则停） | 默认出件加载它；把库内百分比写入本案 |
| 用户点名审意见书 / 审本报告 / 重鉴 / 越权 | `appraisal-review` | 默认出件加载它 |
| 用户点名 but-for / 认定还是排除 / 为何不用参与度 | `causation-analysis` | 另给一套百分比 |
| 用户点名过错怎么细分 | `fault-type-classification` | 另给一套百分比 |
| 用户点名陈述书 | `medical-appraisal-statement` | 默认 `fill_statement` |
| 波次 D 出件（本会话尚未出现其 skill_content） | `medical-report-writing`（格式以该文件为准） | 跳过它；与 fill_report 同轮并行加载；一次调用塞七章；手写终稿 |
| 用户点名鉴定意见书怎么写 / 五性 / 回避 / 程序 | `opinion-writing`（只对表七章） | 默认加载它；输出鉴定意见书或鉴定咨询意见书 |

对不上 21 类：用通用七步（术前检查→指征时机→并发症预案→知情告知→术中操作→术后观察→预后告知）+ `expected_care_plan`。围手术期 VTE、感染、心肺意外按「术后观察/预防」审查，必须先核对预防指南是否适用于该术式。

## 检索（每案一轮，同轮发出）

1. `weknora_clinical(queries=[诊断+临床指南, 术式+适应证禁忌, 争议点])` — 检索本地「临床知识库」原文。与下一工具同轮发出。  
2. `expected_care_plan(diagnosis=主诊断, actual_care=医方已实施摘要, event_year=诊疗年份, focus=争议点, hospital_level=医院等级与科室, procedures=已实施术式, contraindications=出血/休克/过敏等限制因素)` — **每案一次，跳过解析也必须调用**。内部优先查临床知识库，命中不足再谷歌，由 gemini-3.8-flash 生成应然对照。`actual_care` 须含时间链和关键数值，建议 400–2000 字。来源位阶：教科书 > 临床指南 > 专家共识。**先核适用范围，再对照过错**。**禁止**用 `weknora_search` 查临床指南。  
3. `weknora_method(queries=[疾病或术式+过错模板, 过错子类型, 原因力方法, 争议点])` 最多 4 条  
4. `weknora_search` — **仅**伤残/病历书写/SF/T 等鉴定标准，不要查疾病诊疗指南  
5. `weknora_law` — 仅知情或法律争议  

不要再用 `web_search` 重复搜同一疾病指南。同一查询禁止重打。未命中标【医学常识】，禁止编造条款号。

出件闸门：第三/四章若仍引用评残国标、或未列出《临床指南/教科书》、或未传 `appendix_guidelines`，`fill_report` 会禁止 `export_md_to_word`。出现自拟「小结 / 入院诊断 / 原因力分析 / but-for检验 / 待补项」也会被要求重写。

## 取证（波次 C 出过错前必须做）

读完 catalog/timeline/meta 后，用 `parse_records_query` 并行取关键原文，每类 `limit` 建议 12，最大 20。至少覆盖本案有的：

- 医嘱记录（预防用药、抗凝、抗菌、补液）
- 手术记录 + 麻醉记录
- 知情同意（手术/麻醉/特殊治疗）
- 评分或风险评估表原文（VTE、营养、压疮等，有则取）
- 抢救记录 / 会诊记录
- 检验报告、影像报告、病理报告（概要里的数值和结论以这些原件为准）
- 护理记录（观察、约束、巡视、出入量）
- 首次病程和病情第一次变化的病程页

写「患者诊疗过程概要」时，检验、影像、用药、护理和病情经过不要改挂出院记录或死亡记录。出院记录只锚出院时间、出院诊断和出院医嘱；死亡记录只锚死亡时间和死亡诊断。页码用 catalog 的页，先 query 确认该页原文有这句话。

没有医嘱原文，不得写「未见某药」的绝对句，应写「现有已检索材料未见」。禁止只凭时间轴概括定过错。

认定「病程把检查结果张冠李戴」前，必须同时取该病程页 **和** 对应日期影像报告。时间轴里来源为病程/入院的「病程转述检查」不是报告单。`meta.md` 若有解析核验警告，优先按 OCR 串台处理，不得直接写成书写过错。

## 定果与原因力（摘要）

先定 `is_death_case`。非死亡：最终损害后果 + 伤残初步评定；错误出生的果是错误出生本身。死亡：有尸检用尸检，无尸检按病历推定直接/根本死因及死亡进程。禁止用多器官功能衰竭替代根本死因。拟行手术、自身疾病、筛查概率不是医疗损害。第四章机会丧失只描述具体丧失的机会，不机械换算百分比。

原因力先按 7.3.1–7.3.6 定性（无因果关系 0%-4% / 轻微 5%-15% / 次要 16%-44% / 同等 45%-55% / 主要 56%-95% / 全部 96%-100%）。（一）按过错写机制，不写百分比。报告（二）只汇总两条：自身疾病因素约占 a%-b%（等级）；每家医院整体医疗过错约占 c%-d%（等级）。介于相邻两档时可写「轻微至次要原因」，如 5%-30%。不得跨越不相邻档。不是法院赔偿比例，不抄类案，不把文献「预防可降低 60%」写成个案必然避免。

## notes.md 齐套后再出件

过程稿必须有：合规性 / 诊断（含五亚型判断）/ 应然（含指南适用范围、禁忌与可实施性）/ 实然对照（符合项也写）/ 损害分项 / 过错（主类型+子类型）/ 因果（机制 + 三种检验各一句，不要当标题）/ 原因力分项。未齐禁止波次 D。

## 出件

本会话尚未出现 `medical-report-writing` 的 `<skill_content>` 时，**先** `skill(medical-report-writing)`，等它返回后，再同轮并行发出七次 `fill_report`（overview / integrity / diagnosis / treatment / consent / damage / causation 各一次）。其中至少一次（建议 treatment）带上 `appendix_guidelines`＝`expected_care_plan` 返回的**适用于本案**的临床指南/教科书/共识清单。各章句式、节标题、固定开篇句以该 skill 全文为准，不要改写成「门诊阶段」等自拟小节，不要把 `{{占位符}}` 写入正文。  
诊疗规范依据、诊断的诊疗指南依据必须引用临床指南/教科书/共识，禁止用《劳动能力鉴定》《人体损伤致残程度分级》凑数（评残只写第六章）。附录由工具组装为 A 法规（含 SF/T 0097—2021）、B 临床指南与共识；目前不生成附录 C，不要手写「本案已检索并核实的诊疗规范」。  
规定标题：一、患者诊疗过程概要；二、病历合规性分析；三、诊断依据审查分析；四、治疗合理性分析；五、知情同意审查结果；六、损害后果；七、因果关系及原因力初判。  
禁止自拟「小结」「入院诊断」「原因力分析」「but-for检验」「待补项」。全文禁止 Markdown 表格，用编号段落或连贯叙述。引用【医院名称，文书类型，第N页】。  
`missing` 对缺章继续并行补写；`next` 提示缺节则只按该 skill 重写缺节章。七章且小节齐、且 `next` 明确可 export 后，先 `export_md_to_word`。同一次导出写出详细版 `病历分析报告-详细版（患者姓名）.docx` 和标准版 `病历分析报告（患者姓名）.docx`（从详细版复制概要、损害后果、因果关系及原因力初判、备注、附录），再 present 这两份 docx。不要用 `convert_file` 转这份报告。

扫描件禁止整本 `convert_file`。识图只走 parse_records：简单页 qwen3.5-flash，复杂页 gemini-3.1-flash-lite-image，API 并发上限 40。适中审查任务保持 qwen3.8-flash；原因力/多院/死亡切 glm-5.3、gemini-3.8-flash 或 deepseek-v4-pro-0813。不要出鉴定咨询意见书。
