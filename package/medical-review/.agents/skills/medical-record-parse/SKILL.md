---
name: medical-record-parse
description: >
  病历扫描件解析（波次 A）。parse_records 立刻返回，OCR 在后台跑，不断开对话。
  禁止 convert_file 整本、禁止聊天模型看 pages/。用户上传病历、要时间线或分类文书时用。
  不要出鉴定咨询意见书。
metadata:
  parent_skill: medical-appraisal-plan
---

# 病历解析（只整理事实）

已出现过本文件的 `<skill_content>` 后禁止再加载。本步**不做过错、原因力、七章**。材料默认 `materials/`。识图由插件完成：简单页固定 CloseAI qwen3.5-flash，过短或无法识别的复杂页升 gemini-3.1-flash-lite-image；无密钥才回退阿里云 qwen3.8-flash。API 并发上限 40。不要指定 `max_pages`（那是调试用）。

`parse_records` **后台解析、对话不断开**：调用后立刻返回。OCR 不占用当前对话；用户中途提问必须正常回答。不要前台死等，不要因解析中断会话。完成后会收到 background job 通知。

## 流程

| 状态 | 做什么 | 不要做 |
|------|--------|--------|
| 尚未跑或缓存不可用 | 调一次 `parse_records`，拿到 running/job_id 后可告知用户「正在解析，可以继续提问」 | 整本 `convert_file`；`inspect_file`；前台死等；`job_output wait` 空等；用户一说话就停解析；subagent 识图 |
| `running` | 继续对话。等 job 通知，或用户问进度时才 `parse_records_status` | 反复 status；再开第二个 `parse_records`；在未完成时读 catalog 做审查 |
| `done` | **立刻** `job_output`（若有 job_id），并行 `read` `catalog.md` `timeline.md` `meta.md`（有 `parse-warnings.md` 一并读）进入波次 B | 只回复「解析完成」就停；等用户再说「继续」；无故 `force=true` 重跑 |
| `error` / 无 `materials/` | 把失败原因告诉用户；进程退出可再调一次 `parse_records` | 改用手写 OCR 或逐页 convert |

已有 `done` 结果默认复用。只有识别明显错乱（乱码、串页、整本空白）才 `parse_records(force=true)` 一次。

## 取页

审查某类文书用 `parse_records_query`（`category` / `keyword` / `page_from` / `page_to`），每类 `limit` 建议 12，最大 20。大类按工具说明。引用照抄返回的【具体文书，第N页】；页码不明写「页码不明」。检验数值引检验报告，影像结论引影像报告，用药引医嘱，护理观察引护理记录，病情第一次出现引该页病程。出院记录、死亡记录不要代替这些原件。波次 C 对医嘱、手术/麻醉、知情、评分表、抢救/会诊、检验、影像、护理必须取原文，不要只凭时间轴或出院记录。病程「辅助检查」条目化列表可能串日期，影像事实以影像报告为准。

时间轴在同一次解析里由模型按页抽取后写入 `timeline.md`，不是正则扫日期。时间轴偏少或与原文冲突时，用 query 抽关键页补进 `notes.md`，不要重跑 OCR。禁止编造时间轴事件。拟行手术不得写入「已实施」。同一医院多次住院在时间轴上保持一家，不要拆成两家。

不要出鉴定咨询意见书。
