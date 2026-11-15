---
name: traffic-appraisal-plan
description: >
  道路交通事故鉴定的主规划。用户说「交通事故鉴定」「车速鉴定」「痕迹鉴定」
  「事故重建」「车辆安全技术检验」「信号灯状态」「交通设施」「车辆火灾」
  「交通行为方式」「按标准看这个事故」时必须首先加载一次。已加载则禁止再加载。
  上传的是已出具的鉴定意见书并要求审核时，改加载 traffic-report-review。
  用户明确要求出具咨询意见时，再加载 traffic-report-writing。
---

# 交通事故鉴定规划（先加载一次）

本轮若尚未加载本文件，第一个工具调用必须是 `skill(traffic-appraisal-plan)`。已出现本文件的 `<skill_content>` 后禁止再加载。

文书名称只用「交通事故鉴定咨询意见」。它不是司法鉴定意见书，不替代公安机关的事故责任认定。

一份咨询意见只回答一个委托事项，只以一部主标准下结论，只再加载表中的一个技术专项。配套标准不并列成第二套结论。看不出委托事项时，先 `ask_user` 一次，问完之前不要检索、不要出件。

## 主标准与专项

检索用 `weknora_search`，query 写标准全称加待核问题或条款号。同一轮最多 4 次，由下表选定的专项去查，本规划不先泛查。命中标题与该书不符的丢弃。页面图片、英文摘要和乱码不能当条款。未命中写「条款未能核实」。

| 委托事项 | 只加载 | 主标准 | 不要 |
|----------|--------|--------|------|
| 车速，材料未指明数据来源 | `traffic-accident-speed-appraisal` | GB/T 33195—2016《道路交通事故车辆速度鉴定》 | 不要三种方法各给一个速度 |
| 车速，汽车行驶记录仪 | `tachograph-speed-appraisal` | GA/T 1999.1—2022 第1部分 | 没有记录仪数据不要改用视频公式 |
| 车速，事件数据记录系统 | `edr-speed-appraisal` | GA/T 1999.2—2022 第2部分 | 不要把记录仪速度当成 EDR |
| 车速，视频或图像 | `video-speed-appraisal` | GA/T 1999.3—2025 第3部分 | 缺帧率或参照物时写不能鉴定 |
| 现场痕迹勘查 | `accident-scene-trace-survey` | GA/T 41—2019《道路交通事故现场痕迹物证勘查》 | 勘查规范不是同一认定 |
| 痕迹鉴定 | `collision-trace-comparison` | GA/T 1087—2021《道路交通事故痕迹鉴定》 | 程序对照 SF/T 0072，不用速度标准代替痕迹 |
| 痕迹受理、保全和文书 | `traffic-trace-appraisal` | SF/T 0072—2020《道路交通事故痕迹物证鉴定通用规范》 | 本规范不提供比对阈值 |
| 图像重建位置或过程 | `image-accident-reconstruction` | SF/T 0160—2023《基于图像的道路交通事故重建技术规范》 | 要速度数值改走视频车速 |
| 过程分析或仿真，且适用重庆地方标准 | `accident-simulation-reconstruction` | DB50/T 1655—2024《道路交通事故过程分析及重建技术规范》 | 不在适用范围内就写不适用 |
| 事故车辆安全技术 | `vehicle-safety-appraisal` | GA/T 642—2020《道路交通事故车辆安全技术检验鉴定》 | GB 7258、GB 38900 只作对照 |
| 信号灯状态 | `traffic-signal-state-appraisal` | SF/T 0073—2020《基于视频图像的道路交通事故信号灯状态鉴定规范》 | 口述灯色不能代替图像 |
| 道路交通设施状况 | `road-facility-appraisal` | SF/T 0099—2021《道路交通设施安全技术状况鉴定规范》 | 设计、护栏性能、养护不并列成第二结论 |
| 车辆火灾痕迹或起火部位 | `vehicle-fire-trace-appraisal` | SF/T 0100—2021《车辆火灾痕迹物证鉴定技术规范》 | 没有痕迹描述不要指定原因 |
| 涉案人交通行为方式 | `traffic-participant-behavior-appraisal` | SF/T 0162—2023《道路交通事故涉案者交通行为方式鉴定规范》 | 不要写责任比例 |

设施在 `road-facility-appraisal` 之后，仍只再加一个：公路设置与设计 `highway-safety-facility-appraisal`（JTG D81—2017）；护栏碰撞性能 `guardrail-performance-appraisal`（JTG B05-01—2013）；已交付城镇道路养护 `urban-road-maintenance-appraisal`（CJJ 36—2016）。

车辆安全在 `vehicle-safety-appraisal` 之后，仍只再加一个：车型 `vehicle-type-identification`；间接视野 `vehicle-indirect-vision-appraisal`；回复反射或摩托车照明安装 `vehicle-lighting-reflection-appraisal`；电动自行车 `electric-bicycle-performance-appraisal`；电动轮椅车 `powered-wheelchair-performance-appraisal`；维护诊断 `vehicle-maintenance-diagnostics-appraisal`。

全国程序需要时加 `forensic-appraisal-procedure`。重庆案件加 `chongqing-forensic-appraisal-workflow`。这两条是程序，不代替上表的技术主标准。委托、材料和专项要对齐时用 `traffic-accident-appraisal`，技术结论仍是上表的一个专项。

## 只作配套

结论句仍落在上表的主标准。下表只解释类型、装置或设计条件。

| 问题 | 标准 | 由谁查 |
|------|------|--------|
| 机动车类型 | GA 802—2019 | `vehicle-type-identification` |
| 摩托车、轻便摩托车术语 | GB/T 5359.1—2008 | 同上，不另开结论 |
| 摩托车照明及光信号安装 | GB 18100—2025 | `vehicle-lighting-reflection-appraisal` |
| 回复反射装置 | GB 11564—2024 | 同上 |
| 电动自行车 | GB 17761—2024 | `electric-bicycle-performance-appraisal` |
| 电动轮椅车 | GB/T 12996—2024 | `powered-wheelchair-performance-appraisal` |
| 工业车辆类型 | GB/T 6104.1—2018 | `industrial-vehicle-type-identification` |
| 安全运行技术条件 | GB 7258—2017 | `vehicle-safety-appraisal` 对照 |
| 检验项目和方法 | GB 38900—2020 | 同上；文本乱码则条款未能核实 |
| 维护、检测、诊断 | GB/T 18344—2025 | `vehicle-maintenance-diagnostics-appraisal` |
| 间接视野 | GB 15084—2022 | `vehicle-indirect-vision-appraisal` |
| 轿车名义质量分布 | GB/T 5910—1998 | 仅仿真需要时，由 `accident-simulation-reconstruction` 查 |
| 鉴定程序 | 《司法鉴定程序通则》（2016） | `forensic-appraisal-procedure` |
| 重庆流程和附件 | 渝司发〔2020〕71号及其附件 | `chongqing-forensic-appraisal-workflow` |
| 重庆条例 | 《重庆市司法鉴定条例》（2023） | 同上；与指南冲突时以条例命中为准 |

## 怎么做

1. 材料在本轮附件或 `materials/`。扫描 PDF、图片先 `parse_records`，不要整本 `convert_file` OCR。可复制文本才 `convert_file`。已有解析结果就复用，读目录和摘录，不要读 `pages/`。
2. 加载上表的那一个专项。区间平均速度、视频帧间隔、匀减速这一段的初速度，用 `E:/A/package/traffic-accident/.agents/skills/scripts/calculate_speed.py`。公式未命中或没有原始数据时不调用，不心算。
3. 只问答：在对话里给意见，标注【出处：《标准名》条款号】，不出文件。
4. 用户要求出件：再加载一次 `traffic-report-writing`。它只读与该事项对应的一篇写作专题；13 份能力验证答案是写法范例，不是主标准。用户要求审核已有意见书：改加载 `traffic-report-review`，不要同时出一份新的鉴定咨询意见。
