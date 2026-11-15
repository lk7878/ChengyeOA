---
name: disability-period-writing
description: >
  根据病历出具误工期、护理期、营养期咨询意见。用户说「三期」「误工期」「护理期」「营养期」
  「误工护理营养期怎么评」时必须先加载。先 parse_records，再 weknora_search，最后 fill_period_report。
  用户要求评残或生成伤残鉴定报告时，改加载 disability-report-writing。
  用户要求审核已有鉴定意见书时，改加载 disability-report-review。
---

# 误工护理营养期咨询意见

已出现本文件的 `<skill_content>` 后禁止再加载。不要调用 `fill_report` 或 `fill_review_report`。这是咨询意见，不是司法鉴定意见书。

## 步骤

1. 材料在本轮附件或 `materials/`。先回复「正在阅读病历」，扫描件用 `parse_records`（不要填 `max_pages`）。可复制文本的 PDF 才 `convert_file`。抽出诊断、手术、出院时间。没有病历就 `ask_user`，不要估期限。
2. `weknora_search` 检索误工期、护理期、营养期评定规范。query 写「标准全称 + 损伤名称」。条款必须来自命中原文。未命中写「条款未能核实」，不要给天数。
3. 只写一部标准。调用一次 `fill_period_report`。三项期限都写上，每项末尾【出处】。标准给出的是范围就写范围，不要再拆成「若严重则更长」。
4. 生成后 `present` 返回的 docx。对话只报三项期限、适用标准和 Word 路径。

身份和委托单位未知填「（待补充）」。用户只改一项时，其余字段填「（沿用）」。
