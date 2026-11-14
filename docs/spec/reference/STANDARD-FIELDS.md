# 标准工作表字段清单

> 2026-11-06 实现基线：dcf8447d。由 [export-current.ts](../tools/export-current.ts) 从源码生成；不是生产数据库数据或本轮测试报告。

共 48 组、730 个字段定义（跨表同名字段分别计数）。

以下是代码内标准字段模板；已有表可以保留自定义字段、归档字段及本地配置。必填列来自模板元数据，业务创建服务可能另有必填、状态和跨字段校验。字段可编辑性由接口 capabilities、行状态及授权共同决定，不能仅凭字段类型判断。options 列保留来源键、选择项、精度、日期和只读提示，不能把 FORMULA 类型一概理解为任意公式编辑器。

## LEADS — LEADS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；11 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 线索编号 | TEXT | 否 | {"businessKey":"leadNo","businessSource":"LEADS"} |
| 2 | 线索名称 | TEXT | 否 | {"businessKey":"name","businessSource":"LEADS"} |
| 3 | 联系电话 | PHONE | 否 | {"businessKey":"phone","businessSource":"LEADS"} |
| 4 | 微信 | TEXT | 否 | {"businessKey":"wechat","businessSource":"LEADS"} |
| 5 | 业务状态 | TEXT | 否 | {"businessKey":"status","businessSource":"LEADS"} |
| 6 | 线索池状态 | TEXT | 否 | {"businessKey":"poolStatus","businessSource":"LEADS"} |
| 7 | 负责人 | USER | 否 | {"businessKey":"assignedTo","businessSource":"LEADS"} |
| 8 | 所属组织 | ORGANIZATION | 否 | {"businessKey":"branchId","businessSource":"LEADS"} |
| 9 | 意向等级 | NUMBER | 否 | {"businessKey":"intentionLevel","businessSource":"LEADS"} |
| 10 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"LEADS"} |
| 11 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"LEADS"} |

## FOLLOWS — FOLLOWS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；28 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 跟进记录ID | TEXT | 否 | {"businessKey":"followNo","businessSource":"FOLLOWS","primary":true,"helpText":"自动编号 KH01、KH02…，只读"} |
| 2 | 客户名称 | TEXT | 否 | {"businessKey":"customerName","businessSource":"FOLLOWS"} |
| 3 | 微信名 | TEXT | 否 | {"businessKey":"wechat","businessSource":"FOLLOWS"} |
| 4 | 抖音名 | TEXT | 否 | {"businessKey":"douyinName","businessSource":"FOLLOWS"} |
| 5 | 电话 | PHONE | 否 | {"businessKey":"phone","businessSource":"FOLLOWS"} |
| 6 | 地区 | TEXT | 否 | {"businessKey":"region","businessSource":"FOLLOWS"} |
| 7 | 线索ID | TEXT | 否 | {"businessKey":"leadId","businessSource":"FOLLOWS"} |
| 8 | 客户关注点 | TEXT | 否 | {"businessKey":"concerns","businessSource":"FOLLOWS"} |
| 9 | 客户异议点 | TEXT | 否 | {"businessKey":"objections","businessSource":"FOLLOWS"} |
| 10 | 客户阶段 | SINGLE_SELECT | 否 | {"businessKey":"customerStage","businessSource":"FOLLOWS","choices":[{"id":"患者在治疗阶段","name":"患者在治疗阶段"},{"id":"家属在收集证据","name":"家属在收集证据"},{"id":"封存病历","name":"封存病历"},{"id":"已发材料","name":"已发材料"},{"id":"主动来电","name":"主动来电"},{"id":"沟通详情","name":"沟通详情"},{"id":"已报价","name":"已报价"},{"id":"已约面","name":"已约面"},{"id":"推199","name":"推199"},{"id":"已面谈","name":"已面谈"},{"id":"咨询","name":"咨询"},{"id":"已转199","name":"已转199"},{"id":"推599","name":"推599"},{"id":"已转299","name":"已转299"},{"id":"收集病例","name":"收集病例"},{"id":"一转","name":"一转"},{"id":"收集材料","name":"收集材料"},{"id":"推299","name":"推299"},{"id":"案情沟通","name":"案情沟通"}]} |
| 11 | 当前阶段 | SINGLE_SELECT | 否 | {"businessKey":"currentStage","businessSource":"FOLLOWS","choices":[{"id":"指导封存病历","name":"指导封存病历"},{"id":"搜集完整材料","name":"搜集完整材料"},{"id":"没联系上客户","name":"没联系上客户"},{"id":"已委托了律师","name":"已委托了律师"},{"id":"已发律所定位","name":"已发律所定位"},{"id":"待下次详细沟通","name":"待下次详细沟通"},{"id":"待转199","name":"待转199"},{"id":"纯咨询","name":"纯咨询"},{"id":"客户封存病历中","name":"客户封存病历中"},{"id":"已转199","name":"已转199"},{"id":"待下次邀约","name":"待下次邀约"},{"id":"未接通","name":"未接通"},{"id":"已转399","name":"已转399"},{"id":"已委托","name":"已委托"},{"id":"待成交","name":"待成交"},{"id":"待进一步沟通","name":"待进一步沟通"},{"id":"已一转","name":"已一转"},{"id":"转599","name":"转599"},{"id":"待转299","name":"待转299"},{"id":"已约面","name":"已约面"},{"id":"已面谈","name":"已面谈"},{"id":"已转299","name":"已转299"},{"id":"待转399","name":"待转399"},{"id":"已转599","name":"已转599"},{"id":"待一转","name":"待一转"},{"id":"已成交","name":"已成交"},{"id":"邀约上门","name":"邀约上门"},{"id":"已到所","name":"已到所"},{"id":"推指导","name":"推指导"},{"id":"已报价促单","name":"已报价促单"},{"id":"已付咨询费","name":"已付咨询费"},{"id":"无效","name":"无效"},{"id":"待转599","name":"待转599"},{"id":"推399","name":"推399"}]} |
| 12 | 跟进人 | USER | 否 | {"businessKey":"followedBy","businessSource":"FOLLOWS"} |
| 13 | 最后跟进人 | USER | 否 | {"businessKey":"lastFollowBy","businessSource":"FOLLOWS"} |
| 14 | 最后操作人 | USER | 否 | {"businessKey":"lastOperator","businessSource":"FOLLOWS"} |
| 15 | 跟进角色 | SINGLE_SELECT | 否 | {"businessKey":"followRole","businessSource":"FOLLOWS","choices":[{"id":"客服","name":"客服"},{"id":"邀约","name":"邀约"},{"id":"谈案人","name":"谈案人"},{"id":"助理","name":"助理"}]} |
| 16 | 跟进方式 | SINGLE_SELECT | 否 | {"businessKey":"type","businessSource":"FOLLOWS","choices":[{"id":"PHONE","name":"电话"},{"id":"WECHAT","name":"微信"},{"id":"VISIT","name":"面谈"},{"id":"ONLINE","name":"线上会议"},{"id":"SMS","name":"短信"}]} |
| 17 | 跟进结果 | SINGLE_SELECT | 否 | {"businessKey":"result","businessSource":"FOLLOWS","choices":[{"id":"持续沟通","name":"持续沟通"},{"id":"预约中","name":"预约中"},{"id":"待报价","name":"待报价"},{"id":"已报价","name":"已报价"},{"id":"成交","name":"成交"},{"id":"未成交","name":"未成交"},{"id":"无效","name":"无效"},{"id":"成交199","name":"成交199"},{"id":"已到所","name":"已到所"},{"id":"未接通","name":"未接通"},{"id":"5.26晚发病历","name":"5.26晚发病历"},{"id":"咨询","name":"咨询"},{"id":"待转599","name":"待转599"},{"id":"转299","name":"转299"},{"id":"已转299","name":"已转299"},{"id":"已约面","name":"已约面"},{"id":"待转200","name":"待转200"},{"id":"无需求","name":"无需求"}]} |
| 18 | 跟进记录 | LONG_TEXT | 否 | {"businessKey":"content","businessSource":"FOLLOWS"} |
| 19 | 沟通摘要 | TEXT | 否 | {"businessKey":"summary","businessSource":"FOLLOWS"} |
| 20 | 案件类型 | MULTI_SELECT | 否 | {"businessKey":"caseTypes","businessSource":"FOLLOWS","choices":[{"id":"刑事","name":"刑事"},{"id":"医疗","name":"医疗"},{"id":"综合","name":"综合"},{"id":"婚姻","name":"婚姻"},{"id":"医美","name":"医美"},{"id":"合同","name":"合同"},{"id":"侵权","name":"侵权"},{"id":"劳动","name":"劳动"}]} |
| 21 | 下次跟进事项 | LONG_TEXT | 否 | {"businessKey":"nextPlan","businessSource":"FOLLOWS"} |
| 22 | 下次跟进时间 | DATETIME | 否 | {"businessKey":"nextTime","businessSource":"FOLLOWS"} |
| 23 | 录入时间 | DATETIME | 否 | {"businessKey":"enteredAt","businessSource":"FOLLOWS"} |
| 24 | 最后跟进时间 | DATETIME | 否 | {"businessKey":"updatedAt","businessSource":"FOLLOWS"} |
| 25 | 掉库时间 | DATETIME | 否 | {"businessKey":"dropAt","businessSource":"FOLLOWS"} |
| 26 | 是否超期未跟 | BOOLEAN | 否 | {"businessKey":"overdue","businessSource":"FOLLOWS"} |
| 27 | 变更内容 | TEXT | 否 | {"businessKey":"changes","businessSource":"FOLLOWS"} |
| 28 | 附件/录音 | FILE | 否 | {"businessKey":"attachments","businessSource":"FOLLOWS"} |

## QUALITY_ANALYSES — QUALITY_ANALYSES

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；5 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 专项分析 | TEXT | 否 | {"businessKey":"name","businessSource":"QUALITY_ANALYSES"} |
| 2 | 分析状态 | TEXT | 否 | {"businessKey":"status","businessSource":"QUALITY_ANALYSES"} |
| 3 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"QUALITY_ANALYSES"} |
| 4 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"QUALITY_ANALYSES"} |
| 5 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"QUALITY_ANALYSES"} |

## QUALITY_REVIEWS — QUALITY_REVIEWS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；6 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 抽检记录 | TEXT | 否 | {"businessKey":"name","businessSource":"QUALITY_REVIEWS"} |
| 2 | 检查状态 | TEXT | 否 | {"businessKey":"status","businessSource":"QUALITY_REVIEWS"} |
| 3 | 检查人 | CREATED_BY | 否 | {"businessKey":"inspectorUserId","businessSource":"QUALITY_REVIEWS"} |
| 4 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"QUALITY_REVIEWS"} |
| 5 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"QUALITY_REVIEWS"} |
| 6 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"QUALITY_REVIEWS"} |

## QUALITY_ISSUES — QUALITY_ISSUES

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；7 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 问题名称 | TEXT | 否 | {"businessKey":"name","businessSource":"QUALITY_ISSUES"} |
| 2 | 整改状态 | TEXT | 否 | {"businessKey":"status","businessSource":"QUALITY_ISSUES"} |
| 3 | 整改负责人 | CREATED_BY | 否 | {"businessKey":"assigneeUserId","businessSource":"QUALITY_ISSUES"} |
| 4 | 整改期限 | DATETIME | 否 | {"businessKey":"dueAt","businessSource":"QUALITY_ISSUES"} |
| 5 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"QUALITY_ISSUES"} |
| 6 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"QUALITY_ISSUES"} |
| 7 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"QUALITY_ISSUES"} |

## SOP_TASKS — SOP_TASKS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；8 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 节点任务 | TEXT | 否 | {"businessKey":"name","businessSource":"SOP_TASKS"} |
| 2 | 执行状态 | TEXT | 否 | {"businessKey":"status","businessSource":"SOP_TASKS"} |
| 3 | 负责人 | CREATED_BY | 否 | {"businessKey":"assigneeUserId","businessSource":"SOP_TASKS"} |
| 4 | 到期时间 | DATETIME | 否 | {"businessKey":"dueDate","businessSource":"SOP_TASKS"} |
| 5 | 办理备注 | LONG_TEXT | 否 | {"businessKey":"remark","businessSource":"SOP_TASKS"} |
| 6 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"SOP_TASKS"} |
| 7 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"SOP_TASKS"} |
| 8 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"SOP_TASKS"} |

## CHANNELS — CHANNELS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；10 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 渠道编号 | TEXT | 否 | {"businessKey":"code","businessSource":"CHANNELS"} |
| 2 | 渠道名称 | TEXT | 否 | {"businessKey":"name","businessSource":"CHANNELS"} |
| 3 | 渠道类型 | TEXT | 否 | {"businessKey":"type","businessSource":"CHANNELS"} |
| 4 | 渠道说明 | LONG_TEXT | 否 | {"businessKey":"accountInfo","businessSource":"CHANNELS"} |
| 5 | 渠道成本 | CURRENCY | 否 | {"businessKey":"cost","businessSource":"CHANNELS"} |
| 6 | 渠道状态 | TEXT | 否 | {"businessKey":"status","businessSource":"CHANNELS"} |
| 7 | 所属组织 | ORGANIZATION | 否 | {"businessKey":"branchId","businessSource":"CHANNELS"} |
| 8 | 登记人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"CHANNELS"} |
| 9 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"CHANNELS"} |
| 10 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"CHANNELS"} |

## INVENTORY_ITEMS — INVENTORY_ITEMS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；13 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 物品编号 | TEXT | 否 | {"businessKey":"code","businessSource":"INVENTORY_ITEMS"} |
| 2 | 物品名称 | TEXT | 否 | {"businessKey":"name","businessSource":"INVENTORY_ITEMS"} |
| 3 | 物品类型 | TEXT | 否 | {"businessKey":"kind","businessSource":"INVENTORY_ITEMS"} |
| 4 | 物品分类 | TEXT | 否 | {"businessKey":"category","businessSource":"INVENTORY_ITEMS"} |
| 5 | 计量单位 | TEXT | 否 | {"businessKey":"unit","businessSource":"INVENTORY_ITEMS"} |
| 6 | 规格型号 | TEXT | 否 | {"businessKey":"specification","businessSource":"INVENTORY_ITEMS"} |
| 7 | 存放位置 | TEXT | 否 | {"businessKey":"location","businessSource":"INVENTORY_ITEMS"} |
| 8 | 当前库存 | NUMBER | 否 | {"businessKey":"stock","businessSource":"INVENTORY_ITEMS"} |
| 9 | 预警下限 | NUMBER | 否 | {"businessKey":"minimumStock","businessSource":"INVENTORY_ITEMS"} |
| 10 | 物品状态 | TEXT | 否 | {"businessKey":"status","businessSource":"INVENTORY_ITEMS"} |
| 11 | 登记人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"INVENTORY_ITEMS"} |
| 12 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"INVENTORY_ITEMS"} |
| 13 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"INVENTORY_ITEMS"} |

## INVENTORY_MOVEMENTS — INVENTORY_MOVEMENTS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；16 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 出入库编号 | TEXT | 否 | {"businessKey":"documentNo","businessSource":"INVENTORY_MOVEMENTS"} |
| 2 | 关联物品 | TEXT | 否 | {"businessKey":"itemId","businessSource":"INVENTORY_MOVEMENTS"} |
| 3 | 物品名称 | TEXT | 否 | {"businessKey":"itemName","businessSource":"INVENTORY_MOVEMENTS"} |
| 4 | 物品类型 | TEXT | 否 | {"businessKey":"itemKind","businessSource":"INVENTORY_MOVEMENTS"} |
| 5 | 计量单位 | TEXT | 否 | {"businessKey":"unit","businessSource":"INVENTORY_MOVEMENTS"} |
| 6 | 业务类型 | TEXT | 否 | {"businessKey":"action","businessSource":"INVENTORY_MOVEMENTS"} |
| 7 | 变动数量 | NUMBER | 否 | {"businessKey":"quantity","businessSource":"INVENTORY_MOVEMENTS"} |
| 8 | 变动前库存 | NUMBER | 否 | {"businessKey":"beforeStock","businessSource":"INVENTORY_MOVEMENTS"} |
| 9 | 变动后库存 | NUMBER | 否 | {"businessKey":"afterStock","businessSource":"INVENTORY_MOVEMENTS"} |
| 10 | 领用人快照 | TEXT | 否 | {"businessKey":"employeeName","businessSource":"INVENTORY_MOVEMENTS"} |
| 11 | 领用组织快照 | TEXT | 否 | {"businessKey":"organizationPath","businessSource":"INVENTORY_MOVEMENTS"} |
| 12 | 来源供应商 | TEXT | 否 | {"businessKey":"source","businessSource":"INVENTORY_MOVEMENTS"} |
| 13 | 用途原因 | LONG_TEXT | 否 | {"businessKey":"reason","businessSource":"INVENTORY_MOVEMENTS"} |
| 14 | 业务日期 | DATETIME | 否 | {"businessKey":"occurredAt","businessSource":"INVENTORY_MOVEMENTS"} |
| 15 | 登记人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"INVENTORY_MOVEMENTS"} |
| 16 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"INVENTORY_MOVEMENTS"} |

## INVENTORY_STOCKTAKES — INVENTORY_STOCKTAKES

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；11 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 盘点编号 | TEXT | 否 | {"businessKey":"documentNo","businessSource":"INVENTORY_STOCKTAKES"} |
| 2 | 关联物品 | TEXT | 否 | {"businessKey":"itemId","businessSource":"INVENTORY_STOCKTAKES"} |
| 3 | 物品名称 | TEXT | 否 | {"businessKey":"itemName","businessSource":"INVENTORY_STOCKTAKES"} |
| 4 | 计量单位 | TEXT | 否 | {"businessKey":"unit","businessSource":"INVENTORY_STOCKTAKES"} |
| 5 | 账面库存 | NUMBER | 否 | {"businessKey":"bookStock","businessSource":"INVENTORY_STOCKTAKES"} |
| 6 | 实际库存 | NUMBER | 否 | {"businessKey":"actualStock","businessSource":"INVENTORY_STOCKTAKES"} |
| 7 | 盘点差异 | NUMBER | 否 | {"businessKey":"difference","businessSource":"INVENTORY_STOCKTAKES"} |
| 8 | 差异原因 | LONG_TEXT | 否 | {"businessKey":"reason","businessSource":"INVENTORY_STOCKTAKES"} |
| 9 | 业务日期 | DATETIME | 否 | {"businessKey":"occurredAt","businessSource":"INVENTORY_STOCKTAKES"} |
| 10 | 登记人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"INVENTORY_STOCKTAKES"} |
| 11 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"INVENTORY_STOCKTAKES"} |

## PERFORMANCES — PERFORMANCES

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；15 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 被考核人 | USER | 否 | {"businessKey":"employeeId","businessSource":"PERFORMANCES"} |
| 2 | 考核周期 | TEXT | 否 | {"businessKey":"period","businessSource":"PERFORMANCES"} |
| 3 | 考核类型 | TEXT | 否 | {"businessKey":"type","businessSource":"PERFORMANCES"} |
| 4 | 考核状态 | TEXT | 否 | {"businessKey":"status","businessSource":"PERFORMANCES"} |
| 5 | 考核目标 | LONG_TEXT | 否 | {"businessKey":"goal","businessSource":"PERFORMANCES"} |
| 6 | 绩效分数 | CURRENCY | 否 | {"businessKey":"score","businessSource":"PERFORMANCES"} |
| 7 | 奖金 | CURRENCY | 否 | {"businessKey":"bonus","businessSource":"PERFORMANCES"} |
| 8 | 自评分数 | NUMBER | 否 | {"businessKey":"selfScore","businessSource":"PERFORMANCES"} |
| 9 | 自评说明 | LONG_TEXT | 否 | {"businessKey":"selfComment","businessSource":"PERFORMANCES"} |
| 10 | 主管评分 | NUMBER | 否 | {"businessKey":"managerScore","businessSource":"PERFORMANCES"} |
| 11 | 主管评议 | LONG_TEXT | 否 | {"businessKey":"managerComment","businessSource":"PERFORMANCES"} |
| 12 | 备注 | LONG_TEXT | 否 | {"businessKey":"remark","businessSource":"PERFORMANCES"} |
| 13 | 登记人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"PERFORMANCES"} |
| 14 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"PERFORMANCES"} |
| 15 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"PERFORMANCES"} |

## PAYMENTS — PAYMENTS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；17 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 收款编号 | TEXT | 否 | {"businessKey":"paymentNo","businessSource":"PAYMENTS"} |
| 2 | 关联合同 | TEXT | 否 | {"businessKey":"contractId","businessSource":"PAYMENTS"} |
| 3 | 关联客户 | TEXT | 否 | {"businessKey":"customerId","businessSource":"PAYMENTS"} |
| 4 | 收款金额 | CURRENCY | 否 | {"businessKey":"amount","businessSource":"PAYMENTS"} |
| 5 | 收款方式 | TEXT | 否 | {"businessKey":"method","businessSource":"PAYMENTS"} |
| 6 | 收款账户 | TEXT | 否 | {"businessKey":"account","businessSource":"PAYMENTS"} |
| 7 | 收款日期 | DATETIME | 是 | {"businessKey":"paidAt","businessSource":"PAYMENTS"} |
| 8 | 发票号码 | TEXT | 否 | {"businessKey":"invoiceNo","businessSource":"PAYMENTS"} |
| 9 | 开票状态 | TEXT | 否 | {"businessKey":"invoiceStatus","businessSource":"PAYMENTS"} |
| 10 | 发票／收款凭证 | FILE | 否 | {"businessKey":"voucherFiles","businessSource":"PAYMENTS"} |
| 11 | 收款状态 | TEXT | 否 | {"businessKey":"status","businessSource":"PAYMENTS"} |
| 12 | 确认人 | TEXT | 否 | {"businessKey":"confirmedBy","businessSource":"PAYMENTS"} |
| 13 | 确认时间 | DATETIME | 否 | {"businessKey":"confirmedAt","businessSource":"PAYMENTS"} |
| 14 | 备注 | LONG_TEXT | 否 | {"businessKey":"remark","businessSource":"PAYMENTS"} |
| 15 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"PAYMENTS"} |
| 16 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"PAYMENTS"} |
| 17 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"PAYMENTS"} |

## INVOICES — INVOICES

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；12 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 开票申请编号 | TEXT | 否 | {"businessKey":"requestNo","businessSource":"INVOICES"} |
| 2 | 关联合同 | TEXT | 否 | {"businessKey":"contractId","businessSource":"INVOICES"} |
| 3 | 关联客户 | TEXT | 否 | {"businessKey":"customerId","businessSource":"INVOICES"} |
| 4 | 开票金额 | CURRENCY | 否 | {"businessKey":"amount","businessSource":"INVOICES"} |
| 5 | 开票状态 | TEXT | 否 | {"businessKey":"status","businessSource":"INVOICES"} |
| 6 | 发票号码 | TEXT | 否 | {"businessKey":"invoiceNo","businessSource":"INVOICES"} |
| 7 | 申请说明 | LONG_TEXT | 否 | {"businessKey":"reason","businessSource":"INVOICES"} |
| 8 | 审批人 | TEXT | 否 | {"businessKey":"approvedBy","businessSource":"INVOICES"} |
| 9 | 开具时间 | DATETIME | 否 | {"businessKey":"completedAt","businessSource":"INVOICES"} |
| 10 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"INVOICES"} |
| 11 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"INVOICES"} |
| 12 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"INVOICES"} |

## REFUNDS — REFUNDS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；19 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 申请编号 | TEXT | 否 | {"businessKey":"requestNo","businessSource":"REFUNDS"} |
| 2 | 业务类型 | TEXT | 否 | {"businessKey":"type","businessSource":"REFUNDS"} |
| 3 | 关联合同 | TEXT | 否 | {"businessKey":"contractId","businessSource":"REFUNDS"} |
| 4 | 关联客户 | TEXT | 否 | {"businessKey":"customerId","businessSource":"REFUNDS"} |
| 5 | 关联收款 | TEXT | 否 | {"businessKey":"paymentId","businessSource":"REFUNDS"} |
| 6 | 关联计划 | TEXT | 否 | {"businessKey":"planId","businessSource":"REFUNDS"} |
| 7 | 申请金额 | CURRENCY | 否 | {"businessKey":"amount","businessSource":"REFUNDS"} |
| 8 | 退款减免状态 | TEXT | 否 | {"businessKey":"status","businessSource":"REFUNDS"} |
| 9 | 申请理由 | LONG_TEXT | 否 | {"businessKey":"reason","businessSource":"REFUNDS"} |
| 10 | 执行时间 | DATETIME | 否 | {"businessKey":"executedAt","businessSource":"REFUNDS"} |
| 11 | 实际退费金额 | CURRENCY | 否 | {"businessKey":"actualAmount","businessSource":"REFUNDS"} |
| 12 | 退费时间 | DATETIME | 否 | {"businessKey":"paidAt","businessSource":"REFUNDS"} |
| 13 | 退费凭证 | FILE | 否 | {"businessKey":"voucherFiles","businessSource":"REFUNDS"} |
| 14 | 退款人姓名 | TEXT | 否 | {"businessKey":"recipientName","businessSource":"REFUNDS"} |
| 15 | 开户行 | TEXT | 否 | {"businessKey":"recipientBank","businessSource":"REFUNDS"} |
| 16 | 银行卡账号 | TEXT | 否 | {"businessKey":"recipientAccount","businessSource":"REFUNDS"} |
| 17 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"REFUNDS"} |
| 18 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"REFUNDS"} |
| 19 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"REFUNDS"} |

## COSTS — COSTS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；10 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 成本类别 | TEXT | 否 | {"businessKey":"category","businessSource":"COSTS"} |
| 2 | 成本金额 | CURRENCY | 否 | {"businessKey":"amount","businessSource":"COSTS"} |
| 3 | 发生日期 | DATETIME | 否 | {"businessKey":"occurredAt","businessSource":"COSTS"} |
| 4 | 关联案件 | TEXT | 否 | {"businessKey":"caseId","businessSource":"COSTS"} |
| 5 | 关联渠道 | TEXT | 否 | {"businessKey":"channelId","businessSource":"COSTS"} |
| 6 | 来源审批 | TEXT | 否 | {"businessKey":"sourceApprovalId","businessSource":"COSTS"} |
| 7 | 说明 | LONG_TEXT | 否 | {"businessKey":"note","businessSource":"COSTS"} |
| 8 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"COSTS"} |
| 9 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"COSTS"} |
| 10 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"COSTS"} |

## CASES — CASES

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；26 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 合同ID | TEXT | 否 | {"businessKey":"contractDisplayId","businessSource":"CASES"} |
| 2 | 合同未回 | BOOLEAN | 否 | {"businessKey":"intake.contractMissing","businessSource":"CASES"} |
| 3 | 签约日期 | DATETIME | 否 | {"businessKey":"intake.signedDate","businessSource":"CASES"} |
| 4 | 合同编号 | TEXT | 否 | {"businessKey":"intake.contractNumber","businessSource":"CASES"} |
| 5 | 客户姓名 | TEXT | 否 | {"businessKey":"customerName","businessSource":"CASES"} |
| 6 | 地区 | TEXT | 否 | {"businessKey":"intake.region","businessSource":"CASES"} |
| 7 | 客户电话 | TEXT | 否 | {"businessKey":"intake.customerPhone","businessSource":"CASES"} |
| 8 | 对方当事人 | TEXT | 否 | {"businessKey":"intake.opposingParty","businessSource":"CASES"} |
| 9 | 案件类型 | SINGLE_SELECT | 否 | {"businessKey":"intake.caseCategory","businessSource":"CASES","choices":[{"id":"刑事","name":"刑事"},{"id":"民事","name":"民事"},{"id":"行政","name":"行政"},{"id":"商事","name":"商事"},{"id":"执行","name":"执行"},{"id":"国家赔偿","name":"国家赔偿"},{"id":"法律援助","name":"法律援助"},{"id":"非诉","name":"非诉"}]} |
| 10 | 案由 | TEXT | 否 | {"businessKey":"caseType","businessSource":"CASES"} |
| 11 | 代理程序 | MULTI_SELECT | 否 | {"businessKey":"intake.agencyProcedure","businessSource":"CASES","choices":[{"id":"一审","name":"一审"},{"id":"二审","name":"二审"},{"id":"执行","name":"执行"},{"id":"再审","name":"再审"},{"id":"刑事侦查","name":"刑事侦查"},{"id":"审查起诉","name":"审查起诉"},{"id":"行政复议","name":"行政复议"},{"id":"和解","name":"和解"},{"id":"调解","name":"调解"},{"id":"代书","name":"代书"},{"id":"其他非诉","name":"其他非诉"},{"id":"刑事会见","name":"刑事会见"},{"id":"仲裁代理出庭","name":"仲裁代理出庭"},{"id":"仲裁","name":"仲裁"},{"id":"常年法律顾问","name":"常年法律顾问"},{"id":"代为申请立案","name":"代为申请立案"},{"id":"工伤认定程序","name":"工伤认定程序"},{"id":"陪同刑事控告","name":"陪同刑事控告"},{"id":"申请执行","name":"申请执行"},{"id":"咨询费","name":"咨询费"}]} |
| 12 | 代理费收款方式 | SINGLE_SELECT | 否 | {"businessKey":"intake.feeCollectionMethod","businessSource":"CASES","choices":[{"id":"半风险代理","name":"半风险代理"},{"id":"法律援助","name":"法律援助"},{"id":"分段付款","name":"分段付款"},{"id":"常规代理","name":"常规代理"},{"id":"全风险代理","name":"全风险代理"}]} |
| 13 | 固定代理费 | CURRENCY | 否 | {"businessKey":"intake.fixedAgencyFee","businessSource":"CASES"} |
| 14 | 案件基础代理费 | CURRENCY | 否 | {"businessKey":"intake.baseAgencyFee","businessSource":"CASES"} |
| 15 | 风险代理金额 | CURRENCY | 否 | {"businessKey":"intake.riskAgencyAmount","businessSource":"CASES"} |
| 16 | 风险代理比例 | NUMBER | 否 | {"businessKey":"intake.riskAgencyRatio","businessSource":"CASES"} |
| 17 | 代理费付款特别约定 | TEXT | 否 | {"businessKey":"intake.paymentTerms","businessSource":"CASES"} |
| 18 | 所属业务部门 | SINGLE_SELECT | 否 | {"businessKey":"intake.businessDepartment","businessSource":"CASES","choices":[{"id":"律所","name":"律所"},{"id":"大数据中心","name":"大数据中心"},{"id":"侵权中心","name":"侵权中心"},{"id":"律师部","name":"律师部"},{"id":"门市","name":"门市"}]} |
| 19 | 承办律师 | TEXT | 否 | {"businessKey":"intake.handlingLawyer","businessSource":"CASES"} |
| 20 | 合同附件 | FILE | 否 | {"businessKey":"files.合同附件","businessSource":"CASES"} |
| 21 | 收款明细 | LONG_TEXT | 否 | {"businessKey":"receiptDetails","businessSource":"CASES"} |
| 22 | 累计收款总额 | CURRENCY | 否 | {"businessKey":"receiptTotal","businessSource":"CASES"} |
| 23 | 收款凭证（同步） | FILE | 否 | {"businessKey":"receiptFiles","businessSource":"CASES"} |
| 24 | 记录创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"CASES"} |
| 25 | 最近修改时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"CASES"} |
| 26 | 备注 | TEXT | 否 | {"businessKey":"intake.remark","businessSource":"CASES"} |

## CUSTOMERS — CUSTOMERS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；11 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 客户编号 | TEXT | 否 | {"businessKey":"customerNo","businessSource":"CUSTOMERS"} |
| 2 | 地址 | TEXT | 否 | {"businessKey":"address","businessSource":"CUSTOMERS"} |
| 3 | 客户名称 | TEXT | 否 | {"businessKey":"name","businessSource":"CUSTOMERS"} |
| 4 | 联系电话 | PHONE | 否 | {"businessKey":"phone","businessSource":"CUSTOMERS"} |
| 5 | 微信 | TEXT | 否 | {"businessKey":"wechat","businessSource":"CUSTOMERS"} |
| 6 | 客户类型 | TEXT | 否 | {"businessKey":"customerType","businessSource":"CUSTOMERS"} |
| 7 | 客户状态 | TEXT | 否 | {"businessKey":"status","businessSource":"CUSTOMERS"} |
| 8 | 来源线索 | TEXT | 否 | {"businessKey":"sourceLeadId","businessSource":"CUSTOMERS"} |
| 9 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"CUSTOMERS"} |
| 10 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"CUSTOMERS"} |
| 11 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"CUSTOMERS"} |

## NEGOTIATIONS — NEGOTIATIONS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；10 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 谈案编号 | TEXT | 否 | {"businessKey":"negotiationNo","businessSource":"NEGOTIATIONS"} |
| 2 | 客户名称（同步） | TEXT | 否 | {"businessKey":"customerName","businessSource":"NEGOTIATIONS"} |
| 3 | 关联客户 | TEXT | 否 | {"businessKey":"customerId","businessSource":"NEGOTIATIONS"} |
| 4 | 谈案人 | USER | 否 | {"businessKey":"negotiatorEmployeeId","businessSource":"NEGOTIATIONS"} |
| 5 | 报价金额 | CURRENCY | 否 | {"businessKey":"quotedAmount","businessSource":"NEGOTIATIONS"} |
| 6 | 谈案状态 | TEXT | 否 | {"businessKey":"status","businessSource":"NEGOTIATIONS"} |
| 7 | 所属组织 | ORGANIZATION | 否 | {"businessKey":"branchId","businessSource":"NEGOTIATIONS"} |
| 8 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"NEGOTIATIONS"} |
| 9 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"NEGOTIATIONS"} |
| 10 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"NEGOTIATIONS"} |

## CONTRACTS — CONTRACTS

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/crm/workspace-business-table.ts)；15 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 合同编号 | TEXT | 否 | {"businessKey":"contractNo","businessSource":"CONTRACTS"} |
| 2 | 关联谈案 | TEXT | 否 | {"businessKey":"negotiationId","businessSource":"CONTRACTS"} |
| 3 | 谈案编号（同步） | TEXT | 否 | {"businessKey":"negotiationNo","businessSource":"CONTRACTS"} |
| 4 | 谈案报价（同步） | CURRENCY | 否 | {"businessKey":"quotedAmount","businessSource":"CONTRACTS"} |
| 5 | 客户名称（同步） | TEXT | 否 | {"businessKey":"customerName","businessSource":"CONTRACTS"} |
| 6 | 合同名称 | TEXT | 否 | {"businessKey":"title","businessSource":"CONTRACTS"} |
| 7 | 合同类型 | TEXT | 否 | {"businessKey":"contractType","businessSource":"CONTRACTS"} |
| 8 | 关联客户 | TEXT | 否 | {"businessKey":"customerId","businessSource":"CONTRACTS"} |
| 9 | 合同金额 | CURRENCY | 否 | {"businessKey":"amount","businessSource":"CONTRACTS"} |
| 10 | 已收金额 | CURRENCY | 否 | {"businessKey":"receivedAmount","businessSource":"CONTRACTS"} |
| 11 | 合同状态 | TEXT | 否 | {"businessKey":"status","businessSource":"CONTRACTS"} |
| 12 | 所属组织 | ORGANIZATION | 否 | {"businessKey":"branchId","businessSource":"CONTRACTS"} |
| 13 | 创建人 | CREATED_BY | 否 | {"businessKey":"createdBy","businessSource":"CONTRACTS"} |
| 14 | 创建时间 | CREATED_AT | 否 | {"businessKey":"createdAt","businessSource":"CONTRACTS"} |
| 15 | 更新时间 | UPDATED_AT | 否 | {"businessKey":"updatedAt","businessSource":"CONTRACTS"} |

## INVENTORY_REGISTER — 定制物品领用登记表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；14 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 领取日期 | DATETIME | 否 | {"inventoryKey":"领取日期"} |
| 3 | 领取部门 | SINGLE_SELECT | 否 | {"inventoryKey":"领取部门","choices":[{"id":"侵权中心","name":"侵权中心"},{"id":"律师部","name":"律师部"},{"id":"行政后勤","name":"行政后勤"},{"id":"大数据中心","name":"大数据中心"}]} |
| 4 | 领用人 | TEXT | 否 | {"inventoryKey":"领用人"} |
| 5 | 档案袋 | NUMBER | 否 | {"inventoryKey":"档案袋"} |
| 6 | 案卷封底 | NUMBER | 否 | {"inventoryKey":"案卷封底"} |
| 7 | 案卷封面 | NUMBER | 否 | {"inventoryKey":"案卷封面"} |
| 8 | 案卷盒 | NUMBER | 否 | {"inventoryKey":"案卷盒"} |
| 9 | 稿签纸 | NUMBER | 否 | {"inventoryKey":"稿签纸"} |
| 10 | 手提袋 | NUMBER | 否 | {"inventoryKey":"手提袋"} |
| 11 | 大信封 | NUMBER | 否 | {"inventoryKey":"大信封"} |
| 12 | 小信封 | NUMBER | 否 | {"inventoryKey":"小信封"} |
| 13 | 转角合同角 | NUMBER | 否 | {"inventoryKey":"转角合同角"} |
| 14 | 纸杯 | NUMBER | 否 | {"inventoryKey":"纸杯"} |

## INVENTORY_SUMMARY — 定制物品领用统计

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；2 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 物品名称 | TEXT | 否 | {"inventoryKey":"物品名称","primary":true} |
| 2 | 领用数量 | FORMULA | 否 | {"inventoryKey":"领用数量","helpText":"按物品名称匹配登记表同名字段，并汇总当前有权查看的未删除记录；登记变更后自动重算。","formula":"SWITCH(物品名称, \"档案袋\", SUM(定制物品领用登记表.档案袋), \"案卷封底\", SUM(定制物品领用登记表.案卷封底), \"案卷封面\", SUM(定制物品领用登记表.案卷封面), \"案卷盒\", SUM(定制物品领用登记表.案卷盒), \"稿签纸\", SUM(定制物品领用登记表.稿签纸), \"手提袋\", SUM(定制物品领用登记表.手提袋), \"大信封\", SUM(定制物品领用登记表.大信封), \"小信封\", SUM(定制物品领用登记表.小信封), \"转角合同角\", SUM(定制物品领用登记表.转角合同角), \"纸杯\", SUM(定制物品领用登记表.纸杯), 0)"} |

## OFFICE_REGISTER — 办公用品领用明细表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；39 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 领取日期 | DATETIME | 是 | {"inventoryKey":"领取日期"} |
| 3 | 领取部门 | SINGLE_SELECT | 否 | {"inventoryKey":"领取部门","choices":[{"id":"侵权中心","name":"侵权中心"},{"id":"律师部","name":"律师部"},{"id":"行政后勤","name":"行政后勤"},{"id":"大数据中心","name":"大数据中心"}]} |
| 4 | 领用人 | TEXT | 是 | {"inventoryKey":"领用人"} |
| 5 | 15mm夹子 | NUMBER | 否 | {"inventoryKey":"15mm夹子"} |
| 6 | 25mm夹子 | NUMBER | 否 | {"inventoryKey":"25mm夹子"} |
| 7 | 50mm夹子 | NUMBER | 否 | {"inventoryKey":"50mm夹子"} |
| 8 | 5号电池 | NUMBER | 否 | {"inventoryKey":"5号电池"} |
| 9 | 7号电池 | NUMBER | 否 | {"inventoryKey":"7号电池"} |
| 10 | 便利贴 | NUMBER | 否 | {"inventoryKey":"便利贴"} |
| 11 | 标签纸 | NUMBER | 否 | {"inventoryKey":"标签纸"} |
| 12 | 插线板 | NUMBER | 否 | {"inventoryKey":"插线板"} |
| 13 | 订书机 | NUMBER | 否 | {"inventoryKey":"订书机"} |
| 14 | 订书钉 | NUMBER | 否 | {"inventoryKey":"订书钉"} |
| 15 | 固体胶 | NUMBER | 否 | {"inventoryKey":"固体胶"} |
| 16 | 光盘 | NUMBER | 否 | {"inventoryKey":"光盘"} |
| 17 | 黑板擦 | NUMBER | 否 | {"inventoryKey":"黑板擦"} |
| 18 | 回形针 | NUMBER | 否 | {"inventoryKey":"回形针"} |
| 19 | 记号笔 | NUMBER | 否 | {"inventoryKey":"记号笔"} |
| 20 | 剪刀 | NUMBER | 否 | {"inventoryKey":"剪刀"} |
| 21 | 美工刀 | NUMBER | 否 | {"inventoryKey":"美工刀"} |
| 22 | 凭证纸 | NUMBER | 否 | {"inventoryKey":"凭证纸"} |
| 23 | 起钉器 | NUMBER | 否 | {"inventoryKey":"起钉器"} |
| 24 | 铅笔 | NUMBER | 否 | {"inventoryKey":"铅笔"} |
| 25 | 签字笔/笔芯 | NUMBER | 否 | {"inventoryKey":"签字笔/笔芯"} |
| 26 | 鼠标 | NUMBER | 否 | {"inventoryKey":"鼠标"} |
| 27 | 透明文件袋 | NUMBER | 否 | {"inventoryKey":"透明文件袋"} |
| 28 | 文件盒 | NUMBER | 否 | {"inventoryKey":"文件盒"} |
| 29 | 文件框 | NUMBER | 否 | {"inventoryKey":"文件框"} |
| 30 | 橡皮擦 | NUMBER | 否 | {"inventoryKey":"橡皮擦"} |
| 31 | 印泥 | NUMBER | 否 | {"inventoryKey":"印泥"} |
| 32 | 直尺 | NUMBER | 否 | {"inventoryKey":"直尺"} |
| 33 | 装订线 | NUMBER | 否 | {"inventoryKey":"装订线"} |
| 34 | 计算器 | NUMBER | 否 | {"inventoryKey":"计算器"} |
| 35 | 打印纸 | NUMBER | 否 | {"inventoryKey":"打印纸"} |
| 36 | 笔记本 | NUMBER | 否 | {"inventoryKey":"笔记本"} |
| 37 | 两联文件框 | NUMBER | 否 | {"inventoryKey":"两联文件框"} |
| 38 | 液体胶 | NUMBER | 否 | {"inventoryKey":"液体胶"} |
| 39 | 案卷绳 | NUMBER | 否 | {"inventoryKey":"案卷绳"} |

## OFFICE_SUMMARY — 办公用品领用统计

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；2 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 物品名称 | TEXT | 否 | {"inventoryKey":"物品名称","primary":true} |
| 2 | 领用数量 | FORMULA | 否 | {"inventoryKey":"领用数量","helpText":"按物品名称匹配登记表同名字段，并汇总当前有权查看的未删除记录；登记变更后自动重算。","formula":"SWITCH(物品名称, \"15mm夹子\", SUM(办公用品领用明细表.15mm夹子), \"25mm夹子\", SUM(办公用品领用明细表.25mm夹子), \"50mm夹子\", SUM(办公用品领用明细表.50mm夹子), \"5号电池\", SUM(办公用品领用明细表.5号电池), \"7号电池\", SUM(办公用品领用明细表.7号电池), \"便利贴\", SUM(办公用品领用明细表.便利贴), \"标签纸\", SUM(办公用品领用明细表.标签纸), \"插线板\", SUM(办公用品领用明细表.插线板), \"订书机\", SUM(办公用品领用明细表.订书机), \"订书钉\", SUM(办公用品领用明细表.订书钉), \"固体胶\", SUM(办公用品领用明细表.固体胶), \"光盘\", SUM(办公用品领用明细表.光盘), \"黑板擦\", SUM(办公用品领用明细表.黑板擦), \"回形针\", SUM(办公用品领用明细表.回形针), \"记号笔\", SUM(办公用品领用明细表.记号笔), \"剪刀\", SUM(办公用品领用明细表.剪刀), \"美工刀\", SUM(办公用品领用明细表.美工刀), \"凭证纸\", SUM(办公用品领用明细表.凭证纸), \"起钉器\", SUM(办公用品领用明细表.起钉器), \"铅笔\", SUM(办公用品领用明细表.铅笔), \"签字笔/笔芯\", SUM(办公用品领用明细表.签字笔/笔芯), \"鼠标\", SUM(办公用品领用明细表.鼠标), \"透明文件袋\", SUM(办公用品领用明细表.透明文件袋), \"文件盒\", SUM(办公用品领用明细表.文件盒), \"文件框\", SUM(办公用品领用明细表.文件框), \"橡皮擦\", SUM(办公用品领用明细表.橡皮擦), \"印泥\", SUM(办公用品领用明细表.印泥), \"直尺\", SUM(办公用品领用明细表.直尺), \"装订线\", SUM(办公用品领用明细表.装订线), \"计算器\", SUM(办公用品领用明细表.计算器), \"打印纸\", SUM(办公用品领用明细表.打印纸), \"笔记本\", SUM(办公用品领用明细表.笔记本), \"两联文件框\", SUM(办公用品领用明细表.两联文件框), \"液体胶\", SUM(办公用品领用明细表.液体胶), \"案卷绳\", SUM(办公用品领用明细表.案卷绳), 0)"} |

## OFFICE_INBOUND — 入库明细表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；9 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 日期 | DATETIME | 是 | {"inventoryKey":"日期"} |
| 3 | 产品规格 | TEXT | 是 | {"inventoryKey":"产品规格"} |
| 4 | 产品名称 | TEXT | 是 | {"inventoryKey":"产品名称"} |
| 5 | 单位 | TEXT | 否 | {"inventoryKey":"单位"} |
| 6 | 货架 | TEXT | 否 | {"inventoryKey":"货架"} |
| 7 | 入库数量 | NUMBER | 否 | {"inventoryKey":"入库数量"} |
| 8 | 入库人 | TEXT | 是 | {"inventoryKey":"入库人"} |
| 9 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注"} |

## OFFICE_OUTBOUND — 出库明细表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；9 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 日期 | DATETIME | 是 | {"inventoryKey":"日期"} |
| 3 | 产品规格 | TEXT | 是 | {"inventoryKey":"产品规格"} |
| 4 | 产品名称 | TEXT | 是 | {"inventoryKey":"产品名称"} |
| 5 | 单位 | TEXT | 否 | {"inventoryKey":"单位"} |
| 6 | 货架 | TEXT | 否 | {"inventoryKey":"货架"} |
| 7 | 出库数量 | NUMBER | 否 | {"inventoryKey":"出库数量"} |
| 8 | 出库人 | TEXT | 是 | {"inventoryKey":"出库人"} |
| 9 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注"} |

## OFFICE_STOCK — 办公用品库存表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；9 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 类别 | TEXT | 否 | {"inventoryKey":"类别"} |
| 3 | 产品名称 | TEXT | 是 | {"inventoryKey":"产品名称"} |
| 4 | 产品规格 | TEXT | 否 | {"inventoryKey":"产品规格"} |
| 5 | 货架 | TEXT | 否 | {"inventoryKey":"货架"} |
| 6 | 入库数量 | FORMULA | 否 | {"inventoryKey":"入库数量","helpText":"按产品名称汇总同一工作表中当前有权查看的未删除明细，自动重算。","formula":"SUMIF(入库明细表.产品名称, 产品名称, 入库数量)"} |
| 7 | 出库数量 | FORMULA | 否 | {"inventoryKey":"出库数量","helpText":"按产品名称汇总同一工作表中当前有权查看的未删除明细，自动重算。","formula":"SUMIF(出库明细表.产品名称, 产品名称, 出库数量)"} |
| 8 | 库存数量 | FORMULA | 否 | {"inventoryKey":"库存数量","helpText":"按产品名称关联，库存数量＝入库数量－出库数量；随明细变更自动重算。","formula":"入库数量 - 出库数量"} |
| 9 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注"} |

## OFFICE_STOCKTAKE — 定期办公用品盘存记录

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；8 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 列1 | AUTONUMBER | 否 | {"inventoryKey":"列1","primary":true} |
| 2 | 类别 | TEXT | 否 | {"inventoryKey":"类别"} |
| 3 | 产品名称 | TEXT | 否 | {"inventoryKey":"产品名称"} |
| 4 | 产品规格 | TEXT | 否 | {"inventoryKey":"产品规格"} |
| 5 | 货架 | TEXT | 否 | {"inventoryKey":"货架"} |
| 6 | 期初库存量 | NUMBER | 否 | {"inventoryKey":"期初库存量"} |
| 7 | 盘存时数量 | NUMBER | 否 | {"inventoryKey":"盘存时数量"} |
| 8 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注"} |

## ADMIN_EXPENSES — 行政费用支出表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；12 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 采购日期 | DATETIME | 是 | {"inventoryKey":"采购日期","dateOnly":true} |
| 3 | 申请人 | TEXT | 是 | {"inventoryKey":"申请人"} |
| 4 | 支付方式 | SINGLE_SELECT | 否 | {"inventoryKey":"支付方式","choices":[{"id":"微信","name":"微信"},{"id":"支付宝","name":"支付宝"},{"id":"银行转账","name":"银行转账"},{"id":"现金","name":"现金"},{"id":"企业信用卡","name":"企业信用卡"},{"id":"其他","name":"其他"}]} |
| 5 | 费用类型 | SINGLE_SELECT | 否 | {"inventoryKey":"费用类型","choices":[{"id":"办公费","name":"办公费"},{"id":"差旅费","name":"差旅费"},{"id":"招待费","name":"招待费"},{"id":"水电物业费","name":"水电物业费"},{"id":"快递费","name":"快递费"},{"id":"其他","name":"其他"}]} |
| 6 | 产品名称 | TEXT | 是 | {"inventoryKey":"产品名称"} |
| 7 | 单位 | TEXT | 否 | {"inventoryKey":"单位"} |
| 8 | 数量 | NUMBER | 否 | {"inventoryKey":"数量"} |
| 9 | 单价 | CURRENCY | 否 | {"inventoryKey":"单价","numberFormat":"CNY"} |
| 10 | 费用金额 | FORMULA | 否 | {"inventoryKey":"费用金额","numberFormat":"CNY","formula":"[数量] * [单价]","helpText":"数量乘以单价，按人民币保留两位小数；任一项未填写时显示为空，保存后自动重算。"} |
| 11 | 发票是否收到 | SINGLE_SELECT | 否 | {"inventoryKey":"发票是否收到","choices":[{"id":"是","name":"是"},{"id":"否","name":"否"}]} |
| 12 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注"} |

## ADMIN_SEAL — 用印登记

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；6 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 申请时间 | DATETIME | 否 | {"inventoryKey":"申请时间","dateMinute":true,"defaultNow":true} |
| 3 | 申请人 | TEXT | 是 | {"inventoryKey":"申请人"} |
| 4 | 申请事项 | LONG_TEXT | 否 | {"inventoryKey":"申请事项"} |
| 5 | 申请附件 | FILE | 否 | {"inventoryKey":"申请附件"} |
| 6 | 审核意见 | LONG_TEXT | 否 | {"inventoryKey":"审核意见","adminReview":true,"helpText":"仅获授“用印审核”权限且有表格编辑权限的人员可填写审核结果和原因。"} |

## ADMIN_SENT — 发文登记

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；15 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 收文日期 | DATETIME | 是 | {"inventoryKey":"收文日期","dateOnly":true,"defaultNow":true} |
| 3 | 来文单位 | TEXT | 是 | {"inventoryKey":"来文单位"} |
| 4 | 来文字号 | TEXT | 否 | {"inventoryKey":"来文字号"} |
| 5 | 文件标题 | LONG_TEXT | 是 | {"inventoryKey":"文件标题"} |
| 6 | 密级 | SINGLE_SELECT | 否 | {"inventoryKey":"密级","choices":[{"id":"绝密","name":"绝密","color":"red"},{"id":"机密","name":"机密","color":"volcano"},{"id":"秘密","name":"秘密","color":"orange"},{"id":"普通","name":"普通","color":"default"}]} |
| 7 | 紧急程度 | SINGLE_SELECT | 否 | {"inventoryKey":"紧急程度","choices":[{"id":"特急","name":"特急","color":"red"},{"id":"加急","name":"加急","color":"orange"},{"id":"普通","name":"普通","color":"default"}]} |
| 8 | 收文份数 | NUMBER | 否 | {"inventoryKey":"收文份数","nonnegativeInteger":true} |
| 9 | 上传附件 | FILE | 否 | {"inventoryKey":"上传附件"} |
| 10 | 收文人 | TEXT | 是 | {"inventoryKey":"收文人"} |
| 11 | 处理意见 | LONG_TEXT | 否 | {"inventoryKey":"处理意见"} |
| 12 | 承办部门/人 | TEXT | 否 | {"inventoryKey":"承办部门/人"} |
| 13 | 办理时限 | DATETIME | 否 | {"inventoryKey":"办理时限","dateOnly":true} |
| 14 | 办理结果/状态 | SINGLE_SELECT | 否 | {"inventoryKey":"办理结果/状态","choices":[{"id":"待处理","name":"待处理","color":"gold"},{"id":"办理中","name":"办理中","color":"blue"},{"id":"已办结","name":"已办结","color":"green"},{"id":"已归档","name":"已归档","color":"default"}]} |
| 15 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注"} |

## ADMIN_RECEIVED — 收文登记

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；17 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 发文日期 | DATETIME | 是 | {"inventoryKey":"发文日期","dateOnly":true,"defaultNow":true} |
| 3 | 发文字号 | TEXT | 否 | {"inventoryKey":"发文字号"} |
| 4 | 文件标题 | LONG_TEXT | 是 | {"inventoryKey":"文件标题"} |
| 5 | 密级 | SINGLE_SELECT | 否 | {"inventoryKey":"密级","choices":[{"id":"绝密","name":"绝密","color":"red"},{"id":"机密","name":"机密","color":"volcano"},{"id":"秘密","name":"秘密","color":"orange"},{"id":"普通","name":"普通","color":"default"}]} |
| 6 | 紧急程度 | SINGLE_SELECT | 否 | {"inventoryKey":"紧急程度","choices":[{"id":"特急","name":"特急","color":"red"},{"id":"加急","name":"加急","color":"orange"},{"id":"普通","name":"普通","color":"default"}]} |
| 7 | 主送单位 | TEXT | 是 | {"inventoryKey":"主送单位"} |
| 8 | 抄送单位 | TEXT | 否 | {"inventoryKey":"抄送单位"} |
| 9 | 印发份数 | NUMBER | 是 | {"inventoryKey":"印发份数","nonnegativeInteger":true} |
| 10 | 附件清单 | LONG_TEXT | 否 | {"inventoryKey":"附件清单"} |
| 11 | 上传附件 | FILE | 否 | {"inventoryKey":"上传附件"} |
| 12 | 签发人 | TEXT | 否 | {"inventoryKey":"签发人"} |
| 13 | 承办部门/人 | TEXT | 否 | {"inventoryKey":"承办部门/人"} |
| 14 | 发文方式 | SINGLE_SELECT | 否 | {"inventoryKey":"发文方式","choices":[{"id":"当面送达","name":"当面送达"},{"id":"快递","name":"快递"},{"id":"电子送达","name":"电子送达"}]} |
| 15 | 签收人/回执情况 | LONG_TEXT | 否 | {"inventoryKey":"签收人/回执情况"} |
| 16 | 归档份数/位置 | TEXT | 否 | {"inventoryKey":"归档份数/位置"} |
| 17 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注"} |

## ADMIN_MEETINGS — 会议登记

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；15 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 会议编号 | TEXT | 否 | {"inventoryKey":"会议编号","helpText":"同一会议登记表内不可重复；留空时不校验。"} |
| 3 | 会议名称 | TEXT | 是 | {"inventoryKey":"会议名称"} |
| 4 | 会议类型 | SINGLE_SELECT | 否 | {"inventoryKey":"会议类型","choices":[{"id":"例会","name":"例会"},{"id":"专题会","name":"专题会"},{"id":"培训会","name":"培训会"},{"id":"股东大会","name":"股东大会"},{"id":"其他","name":"其他"}]} |
| 5 | 会议时间 | DATETIME | 是 | {"inventoryKey":"会议时间","dateMinute":true} |
| 6 | 会议地点 | TEXT | 是 | {"inventoryKey":"会议地点"} |
| 7 | 主办部门 | TEXT | 否 | {"inventoryKey":"主办部门"} |
| 8 | 主持人 | TEXT | 是 | {"inventoryKey":"主持人"} |
| 9 | 记录人 | TEXT | 是 | {"inventoryKey":"记录人"} |
| 10 | 应到人数 | NUMBER | 否 | {"inventoryKey":"应到人数","nonnegativeInteger":true} |
| 11 | 实到人数 | NUMBER | 否 | {"inventoryKey":"实到人数","nonnegativeInteger":true} |
| 12 | 完成状态 | SINGLE_SELECT | 否 | {"inventoryKey":"完成状态","choices":[{"id":"未开始","name":"未开始","color":"gold"},{"id":"进行中","name":"进行中","color":"blue"},{"id":"已结束","name":"已结束","color":"green"},{"id":"已取消","name":"已取消","color":"default"}]} |
| 13 | 会议所有资料 | FILE | 否 | {"inventoryKey":"会议所有资料"} |
| 14 | 签到表 | FILE | 否 | {"inventoryKey":"签到表"} |
| 15 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注"} |

## HR_ROSTER — 律所员工名册

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；25 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","hrField":true,"primary":true} |
| 2 | 部门 | SINGLE_SELECT | 是 | {"inventoryKey":"部门","hrField":true,"choices":[{"id":"律师部","name":"律师部"},{"id":"侵权中心","name":"侵权中心"},{"id":"综合服务部","name":"综合服务部"},{"id":"大数据运营中心","name":"大数据运营中心"},{"id":"新媒体","name":"新媒体"},{"id":"贵阳分所","name":"贵阳分所"},{"id":"万州分所","name":"万州分所"},{"id":"铜梁分所","name":"铜梁分所"},{"id":"绵阳分所","name":"绵阳分所"},{"id":"成都分所","name":"成都分所"},{"id":"黔江分所","name":"黔江分所"}]} |
| 3 | 姓 名 | TEXT | 是 | {"inventoryKey":"姓 名","hrField":true} |
| 4 | 性别 | SINGLE_SELECT | 否 | {"inventoryKey":"性别","hrField":true,"choices":[{"id":"男","name":"男"},{"id":"女","name":"女"}]} |
| 5 | 职务 | TEXT | 是 | {"inventoryKey":"职务","hrField":true} |
| 6 | 电 话 | TEXT | 是 | {"inventoryKey":"电 话","hrField":true,"hrSensitive":true} |
| 7 | 身份证号码 | TEXT | 否 | {"inventoryKey":"身份证号码","hrField":true,"hrIdentity":true,"hrSensitive":true} |
| 8 | 入职时间 | DATETIME | 是 | {"inventoryKey":"入职时间","hrField":true,"dateOnly":true,"hrPartialDate":true,"helpText":"可填写2024.06或2024-06；仅有月份时保留月份，不补日期。"} |
| 9 | 出生年月 | TEXT | 否 | {"inventoryKey":"出生年月","hrField":true,"hrSensitive":true} |
| 10 | 籍贯 | TEXT | 否 | {"inventoryKey":"籍贯","hrField":true} |
| 11 | 民族 | TEXT | 否 | {"inventoryKey":"民族","hrField":true} |
| 12 | 政治面貌 | TEXT | 否 | {"inventoryKey":"政治面貌","hrField":true} |
| 13 | 执业证号 | TEXT | 否 | {"inventoryKey":"执业证号","hrField":true} |
| 14 | 资格证号 | TEXT | 否 | {"inventoryKey":"资格证号","hrField":true} |
| 15 | 邮箱 | TEXT | 否 | {"inventoryKey":"邮箱","hrField":true,"hrSensitive":true} |
| 16 | 实习协议（劳动合同）时间 | TEXT | 否 | {"inventoryKey":"实习协议（劳动合同）时间","hrField":true} |
| 17 | 社保情况 | TEXT | 否 | {"inventoryKey":"社保情况","hrField":true} |
| 18 | 学历 | TEXT | 否 | {"inventoryKey":"学历","hrField":true} |
| 19 | 毕业院校及时间 | TEXT | 否 | {"inventoryKey":"毕业院校及时间","hrField":true} |
| 20 | 紧急联系人及电话 | TEXT | 否 | {"inventoryKey":"紧急联系人及电话","hrField":true,"hrSensitive":true} |
| 21 | 现居住地 | TEXT | 否 | {"inventoryKey":"现居住地","hrField":true,"hrSensitive":true} |
| 22 | 户籍所在地 | TEXT | 否 | {"inventoryKey":"户籍所在地","hrField":true,"hrSensitive":true} |
| 23 | 留存资料 | LONG_TEXT | 否 | {"inventoryKey":"留存资料","hrField":true,"hrSensitive":true} |
| 24 | 留存资料附件 | FILE | 否 | {"inventoryKey":"留存资料附件","hrField":true,"hrSensitive":true} |
| 25 | 职业状态 | SINGLE_SELECT | 否 | {"inventoryKey":"职业状态","hrField":true,"choices":[{"id":"在职","name":"在职"},{"id":"离职","name":"离职"}]} |

## HR_INTERNS — 实习律师名单

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；12 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","hrField":true,"primary":true} |
| 2 | 姓 名 | TEXT | 是 | {"inventoryKey":"姓 名","hrField":true} |
| 3 | 职务 | TEXT | 否 | {"inventoryKey":"职务","hrField":true} |
| 4 | 性别 | SINGLE_SELECT | 否 | {"inventoryKey":"性别","hrField":true,"choices":[{"id":"男","name":"男"},{"id":"女","name":"女"}]} |
| 5 | 执业（实习）核准时间 | DATETIME | 否 | {"inventoryKey":"执业（实习）核准时间","hrField":true,"dateOnly":true} |
| 6 | 实习证号 | TEXT | 否 | {"inventoryKey":"实习证号","hrField":true} |
| 7 | 资格证号 | TEXT | 否 | {"inventoryKey":"资格证号","hrField":true} |
| 8 | 身份证号码 | TEXT | 否 | {"inventoryKey":"身份证号码","hrField":true,"hrIdentity":true,"hrSensitive":true} |
| 9 | 电 话 | TEXT | 否 | {"inventoryKey":"电 话","hrField":true,"hrSensitive":true} |
| 10 | 指导律师 | TEXT | 是 | {"inventoryKey":"指导律师","hrField":true} |
| 11 | 所在部门/团队 | TEXT | 否 | {"inventoryKey":"所在部门/团队","hrField":true} |
| 12 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注","hrField":true} |

## HR_CONTACTS — 重庆承业律师事务所员工名单及通讯录

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；6 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","hrField":true,"primary":true} |
| 2 | 部门 | TEXT | 是 | {"inventoryKey":"部门","hrField":true} |
| 3 | 姓名 | TEXT | 是 | {"inventoryKey":"姓名","hrField":true} |
| 4 | 职务 | TEXT | 是 | {"inventoryKey":"职务","hrField":true} |
| 5 | 电话 | TEXT | 是 | {"inventoryKey":"电话","hrField":true,"hrSensitive":true} |
| 6 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注","hrField":true} |

## HR_HQ_LAWYERS — 总所在册律师名单

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；11 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","hrField":true,"primary":true} |
| 2 | 部门 | TEXT | 是 | {"inventoryKey":"部门","hrField":true} |
| 3 | 姓名 | TEXT | 是 | {"inventoryKey":"姓名","hrField":true} |
| 4 | 性别 | SINGLE_SELECT | 否 | {"inventoryKey":"性别","hrField":true,"choices":[{"id":"男","name":"男"},{"id":"女","name":"女"}]} |
| 5 | 职务 | TEXT | 否 | {"inventoryKey":"职务","hrField":true} |
| 6 | 执业证号 | TEXT | 是 | {"inventoryKey":"执业证号","hrField":true} |
| 7 | 执业年限 | NUMBER | 是 | {"inventoryKey":"执业年限","hrField":true,"nonnegativeInteger":true} |
| 8 | 身份证号 | TEXT | 否 | {"inventoryKey":"身份证号","hrField":true,"hrIdentity":true,"hrSensitive":true} |
| 9 | 年龄 | FORMULA | 否 | {"inventoryKey":"年龄","hrField":true,"hrAge":true,"helpText":"按当前年份减身份证出生年份计算，只读。"} |
| 10 | 学历 | TEXT | 否 | {"inventoryKey":"学历","hrField":true} |
| 11 | 联系电话 | TEXT | 否 | {"inventoryKey":"联系电话","hrField":true,"hrSensitive":true} |

## HR_BRANCH_LAWYERS — 派驻分所律师明细

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；11 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","hrField":true,"primary":true} |
| 2 | 部门 | TEXT | 是 | {"inventoryKey":"部门","hrField":true} |
| 3 | 姓名 | TEXT | 是 | {"inventoryKey":"姓名","hrField":true} |
| 4 | 性别 | SINGLE_SELECT | 否 | {"inventoryKey":"性别","hrField":true,"choices":[{"id":"男","name":"男"},{"id":"女","name":"女"}]} |
| 5 | 职务 | TEXT | 否 | {"inventoryKey":"职务","hrField":true} |
| 6 | 执业证号 | TEXT | 是 | {"inventoryKey":"执业证号","hrField":true} |
| 7 | 执业年限 | NUMBER | 是 | {"inventoryKey":"执业年限","hrField":true,"nonnegativeInteger":true} |
| 8 | 身份证号 | TEXT | 否 | {"inventoryKey":"身份证号","hrField":true,"hrIdentity":true,"hrSensitive":true} |
| 9 | 年龄 | FORMULA | 否 | {"inventoryKey":"年龄","hrField":true,"hrAge":true,"helpText":"按当前年份减身份证出生年份计算，只读。"} |
| 10 | 学历 | TEXT | 否 | {"inventoryKey":"学历","hrField":true} |
| 11 | 联系电话 | TEXT | 否 | {"inventoryKey":"联系电话","hrField":true,"hrSensitive":true} |

## HR_LEAVERS — 离职人员名单

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；9 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","hrField":true,"primary":true} |
| 2 | 部门 | TEXT | 是 | {"inventoryKey":"部门","hrField":true} |
| 3 | 姓名 | TEXT | 是 | {"inventoryKey":"姓名","hrField":true} |
| 4 | 性别 | SINGLE_SELECT | 否 | {"inventoryKey":"性别","hrField":true,"choices":[{"id":"男","name":"男"},{"id":"女","name":"女"}]} |
| 5 | 职务 | TEXT | 否 | {"inventoryKey":"职务","hrField":true} |
| 6 | 电话 | TEXT | 否 | {"inventoryKey":"电话","hrField":true,"hrSensitive":true} |
| 7 | 身份证号 | TEXT | 否 | {"inventoryKey":"身份证号","hrField":true,"hrIdentity":true,"hrSensitive":true} |
| 8 | 入职时间 | DATETIME | 是 | {"inventoryKey":"入职时间","hrField":true,"dateOnly":true,"hrPartialDate":true,"helpText":"可填写2024.06或2024-06；仅有月份时保留月份，不补日期。"} |
| 9 | 离职时间 | DATETIME | 是 | {"inventoryKey":"离职时间","hrField":true,"dateOnly":true} |

## HR_NEW_HIRES — 新入职人员名单

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；56 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | ID | AUTONUMBER | 否 | {"inventoryKey":"ID","hrField":true,"primary":true} |
| 2 | 入职部门 | TEXT | 是 | {"inventoryKey":"入职部门","hrField":true} |
| 3 | 岗位 | TEXT | 是 | {"inventoryKey":"岗位","hrField":true} |
| 4 | 填表日期 | DATETIME | 否 | {"inventoryKey":"填表日期","hrField":true,"dateOnly":true,"defaultNow":true} |
| 5 | 员工编号 | TEXT | 否 | {"inventoryKey":"员工编号","hrField":true} |
| 6 | 应聘者姓名 | TEXT | 是 | {"inventoryKey":"应聘者姓名","hrField":true} |
| 7 | 性别 | SINGLE_SELECT | 否 | {"inventoryKey":"性别","hrField":true,"choices":[{"id":"男","name":"男"},{"id":"女","name":"女"}]} |
| 8 | 出生日期 | DATETIME | 否 | {"inventoryKey":"出生日期","hrField":true,"hrSensitive":true,"dateOnly":true} |
| 9 | 籍贯 | TEXT | 否 | {"inventoryKey":"籍贯","hrField":true} |
| 10 | 民族 | TEXT | 否 | {"inventoryKey":"民族","hrField":true} |
| 11 | 身高 | NUMBER | 否 | {"inventoryKey":"身高","hrField":true} |
| 12 | 体重 | NUMBER | 否 | {"inventoryKey":"体重","hrField":true} |
| 13 | 血型 | SINGLE_SELECT | 否 | {"inventoryKey":"血型","hrField":true,"choices":[{"id":"A型","name":"A型"},{"id":"B型","name":"B型"},{"id":"AB型","name":"AB型"},{"id":"O型","name":"O型"},{"id":"其他","name":"其他"}]} |
| 14 | 政治面貌 | TEXT | 否 | {"inventoryKey":"政治面貌","hrField":true} |
| 15 | 婚姻状况 | SINGLE_SELECT | 否 | {"inventoryKey":"婚姻状况","hrField":true,"choices":[{"id":"未婚","name":"未婚"},{"id":"已婚","name":"已婚"},{"id":"离异","name":"离异"},{"id":"丧偶","name":"丧偶"}]} |
| 16 | 职业状况 | SINGLE_SELECT | 否 | {"inventoryKey":"职业状况","hrField":true,"choices":[{"id":"在职","name":"在职"},{"id":"离职","name":"离职"},{"id":"待业","name":"待业"}]} |
| 17 | 最高学历 | SINGLE_SELECT | 否 | {"inventoryKey":"最高学历","hrField":true,"choices":[{"id":"高中及以下","name":"高中及以下"},{"id":"中专","name":"中专"},{"id":"专科","name":"专科"},{"id":"本科","name":"本科"},{"id":"硕士","name":"硕士"},{"id":"博士","name":"博士"},{"id":"其他","name":"其他"}]} |
| 18 | 毕业学校 | TEXT | 否 | {"inventoryKey":"毕业学校","hrField":true} |
| 19 | 个人相片 | FILE | 否 | {"inventoryKey":"个人相片","hrField":true,"hrSensitive":true} |
| 20 | 电话号码 | TEXT | 否 | {"inventoryKey":"电话号码","hrField":true,"hrSensitive":true} |
| 21 | 邮箱 | TEXT | 否 | {"inventoryKey":"邮箱","hrField":true,"hrSensitive":true} |
| 22 | 身份证号 | TEXT | 否 | {"inventoryKey":"身份证号","hrField":true,"hrIdentity":true,"hrSensitive":true} |
| 23 | 现居住地 | TEXT | 否 | {"inventoryKey":"现居住地","hrField":true,"hrSensitive":true} |
| 24 | 户籍类型 | SINGLE_SELECT | 否 | {"inventoryKey":"户籍类型","hrField":true,"hrSensitive":true,"choices":[{"id":"城镇","name":"城镇"},{"id":"农村","name":"农村"}]} |
| 25 | 户籍所在地 | TEXT | 否 | {"inventoryKey":"户籍所在地","hrField":true,"hrSensitive":true} |
| 26 | 紧急联系人 | TEXT | 否 | {"inventoryKey":"紧急联系人","hrField":true,"hrSensitive":true} |
| 27 | 紧急联系人电话 | TEXT | 否 | {"inventoryKey":"紧急联系人电话","hrField":true,"hrSensitive":true} |
| 28 | 姓名 | TEXT | 否 | {"inventoryKey":"姓名","hrField":true,"hrSensitive":true,"helpText":"家庭成员姓名"} |
| 29 | 计算机水平 | TEXT | 否 | {"inventoryKey":"计算机水平","hrField":true} |
| 30 | 入职时间 | DATETIME | 否 | {"inventoryKey":"入职时间","hrField":true,"dateOnly":true,"hrPartialDate":true,"helpText":"可填写2024.06或2024-06；仅有月份时保留月份，不补日期。"} |
| 31 | 入学时间 | DATETIME | 否 | {"inventoryKey":"入学时间","hrField":true,"dateOnly":true} |
| 32 | 毕业时间 | DATETIME | 否 | {"inventoryKey":"毕业时间","hrField":true,"dateOnly":true} |
| 33 | 学校/培训机构 | TEXT | 否 | {"inventoryKey":"学校/培训机构","hrField":true} |
| 34 | 专业/培训内容 | TEXT | 否 | {"inventoryKey":"专业/培训内容","hrField":true} |
| 35 | 所获学历/资质 | TEXT | 否 | {"inventoryKey":"所获学历/资质","hrField":true} |
| 36 | 离职时间 | DATETIME | 否 | {"inventoryKey":"离职时间","hrField":true,"dateOnly":true} |
| 37 | 职务/主要工作职责 | LONG_TEXT | 否 | {"inventoryKey":"职务/主要工作职责","hrField":true} |
| 38 | 薪酬 | TEXT | 否 | {"inventoryKey":"薪酬","hrField":true,"hrSensitive":true} |
| 39 | 离职原因 | TEXT | 否 | {"inventoryKey":"离职原因","hrField":true,"hrSensitive":true} |
| 40 | 外语（语种） | TEXT | 否 | {"inventoryKey":"外语（语种）","hrField":true} |
| 41 | 级别 | TEXT | 否 | {"inventoryKey":"级别","hrField":true} |
| 42 | 其他技能 | LONG_TEXT | 否 | {"inventoryKey":"其他技能","hrField":true} |
| 43 | 个人爱好及特长 | LONG_TEXT | 否 | {"inventoryKey":"个人爱好及特长","hrField":true} |
| 44 | 脱产/在职 | SINGLE_SELECT | 否 | {"inventoryKey":"脱产/在职","hrField":true,"choices":[{"id":"脱产","name":"脱产"},{"id":"在职","name":"在职"}]} |
| 45 | 称谓 | TEXT | 否 | {"inventoryKey":"称谓","hrField":true,"hrSensitive":true} |
| 46 | 工作单位 | TEXT | 否 | {"inventoryKey":"工作单位","hrField":true,"hrSensitive":true} |
| 47 | 职务 | TEXT | 否 | {"inventoryKey":"职务","hrField":true,"hrSensitive":true} |
| 48 | 联系电话 | TEXT | 否 | {"inventoryKey":"联系电话","hrField":true,"hrSensitive":true} |
| 49 | 证明人及电话 | TEXT | 否 | {"inventoryKey":"证明人及电话","hrField":true,"hrSensitive":true} |
| 50 | 证明人和电话 | TEXT | 否 | {"inventoryKey":"证明人和电话","hrField":true,"hrSensitive":true} |
| 51 | 能否出差 | SINGLE_SELECT | 否 | {"inventoryKey":"能否出差","hrField":true,"choices":[{"id":"能","name":"能"},{"id":"否","name":"否"}]} |
| 52 | 能否加班 | SINGLE_SELECT | 否 | {"inventoryKey":"能否加班","hrField":true,"choices":[{"id":"能","name":"能"},{"id":"否","name":"否"}]} |
| 53 | 能否接受工作调动 | SINGLE_SELECT | 否 | {"inventoryKey":"能否接受工作调动","hrField":true,"choices":[{"id":"能","name":"能"},{"id":"否","name":"否"}]} |
| 54 | 是否曾在我公司应聘 | SINGLE_SELECT | 否 | {"inventoryKey":"是否曾在我公司应聘","hrField":true,"choices":[{"id":"是","name":"是"},{"id":"否","name":"否"}]} |
| 55 | 是否有亲属朋友在我公司工作 | SINGLE_SELECT | 否 | {"inventoryKey":"是否有亲属朋友在我公司工作","hrField":true,"choices":[{"id":"是","name":"是"},{"id":"否","name":"否"}]} |
| 56 | 亲属姓名 | TEXT | 否 | {"inventoryKey":"亲属姓名","hrField":true,"hrSensitive":true,"helpText":"有亲属朋友在本公司工作时必填。"} |

## HR_RECRUITMENT — 招聘面试

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；10 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","hrField":true,"primary":true} |
| 2 | 招聘岗位 | TEXT | 是 | {"inventoryKey":"招聘岗位","hrField":true} |
| 3 | 候选人姓名 | TEXT | 是 | {"inventoryKey":"候选人姓名","hrField":true} |
| 4 | 招聘渠道 | SINGLE_SELECT | 否 | {"inventoryKey":"招聘渠道","hrField":true,"choices":[{"id":"Boss直聘","name":"Boss直聘"},{"id":"智联招聘","name":"智联招聘"},{"id":"前程无忧","name":"前程无忧"},{"id":"内部推荐","name":"内部推荐"},{"id":"猎头","name":"猎头"},{"id":"校招","name":"校招"},{"id":"其他","name":"其他"}]} |
| 5 | 联系方式 | TEXT | 否 | {"inventoryKey":"联系方式","hrField":true,"hrSensitive":true} |
| 6 | 面试状态 | SINGLE_SELECT | 是 | {"inventoryKey":"面试状态","hrField":true,"choices":[{"id":"简历初筛","name":"简历初筛"},{"id":"待初试","name":"待初试"},{"id":"待复试","name":"待复试"},{"id":"已通过","name":"已通过"},{"id":"已淘汰","name":"已淘汰"},{"id":"已入职","name":"已入职"}]} |
| 7 | 面试时间 | DATETIME | 否 | {"inventoryKey":"面试时间","hrField":true,"dateMinute":true} |
| 8 | 入职日期 | DATETIME | 否 | {"inventoryKey":"入职日期","hrField":true,"dateOnly":true} |
| 9 | 招聘负责人 | TEXT | 是 | {"inventoryKey":"招聘负责人","hrField":true} |
| 10 | 备注 | LONG_TEXT | 否 | {"inventoryKey":"备注","hrField":true,"hrSensitive":true} |

## CASE_ARCHIVE_REVIEW — 案件归档审核

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；9 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 审理时间 | DATETIME | 是 | {"inventoryKey":"审理时间","dateOnly":true} |
| 3 | 合同编号 | TEXT | 是 | {"inventoryKey":"合同编号","helpText":"填写对应合同编号，保留原编号格式；此表的修改不会自动改变合同或案件状态。"} |
| 4 | 当事人 | TEXT | 是 | {"inventoryKey":"当事人"} |
| 5 | 案件类型 | TEXT | 是 | {"inventoryKey":"案件类型"} |
| 6 | 问题 | LONG_TEXT | 否 | {"inventoryKey":"问题"} |
| 7 | 是否盖章归档 | SINGLE_SELECT | 是 | {"inventoryKey":"是否盖章归档","choices":[{"id":"是","name":"是"},{"id":"否","name":"否"}]} |
| 8 | 质保金是否签字 | SINGLE_SELECT | 是 | {"inventoryKey":"质保金是否签字","choices":[{"id":"是","name":"是"},{"id":"否","name":"否"},{"id":"不涉及","name":"不涉及"}]} |
| 9 | 质保金结算凭证 | FILE | 否 | {"inventoryKey":"质保金结算凭证"} |

## CASE_ARCHIVE_REGISTER — 案卷档案登记表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；12 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 归档时间 | DATETIME | 是 | {"inventoryKey":"归档时间","dateOnly":true} |
| 3 | 编号 | TEXT | 否 | {"inventoryKey":"编号"} |
| 4 | 类型 | TEXT | 是 | {"inventoryKey":"类型","helpText":"例如：民事、刑事、行政、非诉、顾问。"} |
| 5 | 档号 | TEXT | 是 | {"inventoryKey":"档号","helpText":"同一登记表内不可重复；删除后可重新使用，恢复时重新校验。"} |
| 6 | 案由 | TEXT | 是 | {"inventoryKey":"案由"} |
| 7 | 当事人 | TEXT | 是 | {"inventoryKey":"当事人"} |
| 8 | 律师 | TEXT | 是 | {"inventoryKey":"律师"} |
| 9 | 合同编号 | TEXT | 否 | {"inventoryKey":"合同编号","helpText":"填写对应合同编号，保留原编号格式；此表的修改不会自动改变合同或案件状态。"} |
| 10 | 档案盒号 | TEXT | 否 | {"inventoryKey":"档案盒号"} |
| 11 | 柜号 | TEXT | 否 | {"inventoryKey":"柜号"} |
| 12 | 备注 | TEXT | 否 | {"inventoryKey":"备注"} |

## CASE_ARCHIVE_OFFLINE — 案卷档案登记表(不上传法网)

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/inventory-worksheets.ts)；12 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 序号 | AUTONUMBER | 否 | {"inventoryKey":"序号","primary":true} |
| 2 | 归档时间 | DATETIME | 是 | {"inventoryKey":"归档时间","dateOnly":true} |
| 3 | 编号 | TEXT | 否 | {"inventoryKey":"编号"} |
| 4 | 类型 | TEXT | 是 | {"inventoryKey":"类型","helpText":"例如：民事、刑事、行政、非诉、顾问。"} |
| 5 | 档号 | TEXT | 是 | {"inventoryKey":"档号","helpText":"同一登记表内不可重复；删除后可重新使用，恢复时重新校验。"} |
| 6 | 案由 | TEXT | 是 | {"inventoryKey":"案由"} |
| 7 | 当事人 | TEXT | 是 | {"inventoryKey":"当事人"} |
| 8 | 律师 | TEXT | 是 | {"inventoryKey":"律师"} |
| 9 | 合同编号 | TEXT | 否 | {"inventoryKey":"合同编号","helpText":"填写对应合同编号，保留原编号格式；此表的修改不会自动改变合同或案件状态。"} |
| 10 | 档案盒号 | TEXT | 否 | {"inventoryKey":"档案盒号"} |
| 11 | 柜号 | TEXT | 否 | {"inventoryKey":"柜号"} |
| 12 | 备注 | TEXT | 否 | {"inventoryKey":"备注"} |

## AFTER_SALES — 售后管理表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/lifecycle-worksheet.ts)；33 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 签约日期 | DATETIME | 否 | {"lifecycleKey":"signedDate","defaultVisible":true} |
| 2 | 客户姓名 | TEXT | 否 | {"lifecycleKey":"customerName","defaultVisible":true} |
| 3 | 案件类型 | TEXT | 否 | {"lifecycleKey":"caseCategory","defaultVisible":true} |
| 4 | 代理程序 | MULTI_SELECT | 否 | {"lifecycleKey":"agencyProcedure","defaultVisible":true,"choices":[{"id":"一审","name":"一审"},{"id":"二审","name":"二审"},{"id":"执行","name":"执行"},{"id":"再审","name":"再审"},{"id":"刑事侦查","name":"刑事侦查"},{"id":"审查起诉","name":"审查起诉"},{"id":"行政复议","name":"行政复议"},{"id":"和解","name":"和解"},{"id":"调解","name":"调解"},{"id":"代书","name":"代书"},{"id":"其他非诉","name":"其他非诉"},{"id":"刑事会见","name":"刑事会见"},{"id":"仲裁代理出庭","name":"仲裁代理出庭"},{"id":"仲裁","name":"仲裁"},{"id":"常年法律顾问","name":"常年法律顾问"},{"id":"代为申请立案","name":"代为申请立案"},{"id":"工伤认定程序","name":"工伤认定程序"},{"id":"陪同刑事控告","name":"陪同刑事控告"},{"id":"申请执行","name":"申请执行"},{"id":"咨询费","name":"咨询费"}]} |
| 5 | 合同编号 | TEXT | 是 | {"lifecycleKey":"upstreamId","defaultVisible":true} |
| 6 | 客户电话 | TEXT | 否 | {"lifecycleKey":"customerPhone","defaultVisible":true} |
| 7 | 承办律师 | TEXT | 否 | {"lifecycleKey":"handlingLawyer","defaultVisible":true} |
| 8 | 案由 | TEXT | 否 | {"lifecycleKey":"caseCause","defaultVisible":true} |
| 9 | 收费总金额 | TEXT | 否 | {"lifecycleKey":"feeTotal","defaultVisible":true} |
| 10 | 是否解除合同 | SINGLE_SELECT | 否 | {"lifecycleKey":"terminated","defaultVisible":true,"choices":[{"id":"是","name":"是"},{"id":"否","name":"否"}]} |
| 11 | 退费金额 | CURRENCY | 否 | {"lifecycleKey":"refundAmount","defaultVisible":true} |
| 12 | 退款凭证 | FILE | 否 | {"lifecycleKey":"refundReceipt","defaultVisible":true} |
| 13 | 退费原因 | TEXT | 否 | {"lifecycleKey":"refundReason","defaultVisible":true} |
| 14 | 是否结案 | SINGLE_SELECT | 否 | {"lifecycleKey":"closed","defaultVisible":true,"choices":[{"id":"是","name":"是"},{"id":"否","name":"否"}]} |
| 15 | 汇报月份 | DATETIME | 否 | {"lifecycleKey":"reportMonth","defaultVisible":true} |
| 16 | 售后来源 | SINGLE_SELECT | 否 | {"lifecycleKey":"afterSalesSource","defaultVisible":true,"choices":[{"id":"当事人","name":"当事人"},{"id":"司法局","name":"司法局"}]} |
| 17 | 复盘情况 | TEXT | 否 | {"lifecycleKey":"review","defaultVisible":true} |
| 18 | 当事人诉求 | TEXT | 是 | {"lifecycleKey":"content","defaultVisible":true} |
| 19 | 问题缘由 | SINGLE_SELECT | 否 | {"lifecycleKey":"problemCause","defaultVisible":true,"choices":[{"id":"当事人","name":"当事人"},{"id":"律师助理","name":"律师助理"},{"id":"律师","name":"律师"},{"id":"证据不足","name":"证据不足"},{"id":"制度原因","name":"制度原因"}]} |
| 20 | 处理情况1 | TEXT | 否 | {"lifecycleKey":"handling1","defaultVisible":true} |
| 21 | 处理情况2 | TEXT | 否 | {"lifecycleKey":"handling2","defaultVisible":true} |
| 22 | 处理情况3 | TEXT | 否 | {"lifecycleKey":"handling3","defaultVisible":true} |
| 23 | 处理情况4 | TEXT | 否 | {"lifecycleKey":"handling4","defaultVisible":true} |
| 24 | 处理情况5 | TEXT | 否 | {"lifecycleKey":"handling5","defaultVisible":true} |
| 25 | 处理情况6 | TEXT | 否 | {"lifecycleKey":"handling6","defaultVisible":true} |
| 26 | 创建时间 | CREATED_AT | 否 | {"lifecycleKey":"createdAt","defaultVisible":true} |
| 27 | 最新更新时间 | UPDATED_AT | 否 | {"lifecycleKey":"updatedAt","defaultVisible":true} |
| 28 | 协商状态 | SINGLE_SELECT | 是 | {"lifecycleKey":"status","defaultVisible":false,"choices":[{"id":"OPEN","name":"协商中"},{"id":"RESOLVED","name":"已解决"},{"id":"REFUND_REQUIRED","name":"协商未果 / 需退款"}]} |
| 29 | 合同编号（同步） | TEXT | 否 | {"lifecycleKey":"contractNo","defaultVisible":false} |
| 30 | 案件编号（同步） | TEXT | 否 | {"lifecycleKey":"caseNo","defaultVisible":false} |
| 31 | 案件名称（同步） | TEXT | 否 | {"lifecycleKey":"caseTitle","defaultVisible":false} |
| 32 | 合同金额（同步） | CURRENCY | 否 | {"lifecycleKey":"contractAmount","defaultVisible":false} |
| 33 | 办理备注 | TEXT | 否 | {"lifecycleKey":"remark","defaultVisible":false} |

## CASE_REFUNDS — 退费管理表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/lifecycle-worksheet.ts)；36 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 签约日期 | DATETIME | 否 | {"lifecycleKey":"signedDate","defaultVisible":true} |
| 2 | 客户姓名 | TEXT | 否 | {"lifecycleKey":"customerName","defaultVisible":true} |
| 3 | 案件类型 | TEXT | 否 | {"lifecycleKey":"caseCategory","defaultVisible":true} |
| 4 | 代理程序 | MULTI_SELECT | 否 | {"lifecycleKey":"agencyProcedure","defaultVisible":true,"choices":[{"id":"一审","name":"一审"},{"id":"二审","name":"二审"},{"id":"执行","name":"执行"},{"id":"再审","name":"再审"},{"id":"刑事侦查","name":"刑事侦查"},{"id":"审查起诉","name":"审查起诉"},{"id":"行政复议","name":"行政复议"},{"id":"和解","name":"和解"},{"id":"调解","name":"调解"},{"id":"代书","name":"代书"},{"id":"其他非诉","name":"其他非诉"},{"id":"刑事会见","name":"刑事会见"},{"id":"仲裁代理出庭","name":"仲裁代理出庭"},{"id":"仲裁","name":"仲裁"},{"id":"常年法律顾问","name":"常年法律顾问"},{"id":"代为申请立案","name":"代为申请立案"},{"id":"工伤认定程序","name":"工伤认定程序"},{"id":"陪同刑事控告","name":"陪同刑事控告"},{"id":"申请执行","name":"申请执行"},{"id":"咨询费","name":"咨询费"}]} |
| 5 | 合同编号 | TEXT | 是 | {"lifecycleKey":"upstreamId","defaultVisible":true} |
| 6 | 客户电话 | TEXT | 否 | {"lifecycleKey":"customerPhone","defaultVisible":true} |
| 7 | 承办律师 | TEXT | 否 | {"lifecycleKey":"handlingLawyer","defaultVisible":true} |
| 8 | 案由 | TEXT | 否 | {"lifecycleKey":"caseCause","defaultVisible":true} |
| 9 | 是否解除合同 | SINGLE_SELECT | 否 | {"lifecycleKey":"terminated","defaultVisible":true,"choices":[{"id":"是","name":"是"},{"id":"否","name":"否"}]} |
| 10 | 收费总金额 | TEXT | 否 | {"lifecycleKey":"feeTotalLookup","defaultVisible":true} |
| 11 | 申请退款金额 | CURRENCY | 是 | {"lifecycleKey":"amount","defaultVisible":true} |
| 12 | 退款人姓名 | TEXT | 否 | {"lifecycleKey":"recipientName","defaultVisible":true} |
| 13 | 退款人开户行 | TEXT | 否 | {"lifecycleKey":"recipientBank","defaultVisible":true} |
| 14 | 退款人银行账号 | TEXT | 否 | {"lifecycleKey":"recipientAccount","defaultVisible":true} |
| 15 | 银行卡附件 | FILE | 否 | {"lifecycleKey":"bankCardFiles","defaultVisible":true} |
| 16 | 律师工作内容 | TEXT | 否 | {"lifecycleKey":"lawyerWork","defaultVisible":true} |
| 17 | 律师工作文书材料 | FILE | 否 | {"lifecycleKey":"lawyerWorkFiles","defaultVisible":true} |
| 18 | 面谈记录 | TEXT | 否 | {"lifecycleKey":"interview","defaultVisible":true} |
| 19 | 面谈记录材料 | FILE | 否 | {"lifecycleKey":"interviewFiles","defaultVisible":true} |
| 20 | 退案事由 | TEXT | 是 | {"lifecycleKey":"content","defaultVisible":true} |
| 21 | 解除委托代理协议 | FILE | 否 | {"lifecycleKey":"terminationFiles","defaultVisible":true} |
| 22 | 面谈人 | TEXT | 否 | {"lifecycleKey":"interviewer","defaultVisible":true} |
| 23 | 部门负责人面谈结果 | TEXT | 否 | {"lifecycleKey":"departmentInterview","defaultVisible":true} |
| 24 | 退款凭证 | FILE | 否 | {"lifecycleKey":"refundReceiptLookup","defaultVisible":true} |
| 25 | 实际退费金额 | CURRENCY | 否 | {"lifecycleKey":"actualRefundAmount","defaultVisible":true} |
| 26 | 退费时间 | DATETIME | 否 | {"lifecycleKey":"refundPaidAt","defaultVisible":true} |
| 27 | 退款状态 | TEXT | 否 | {"lifecycleKey":"refundStatus","defaultVisible":true} |
| 28 | 退费单号 | TEXT | 否 | {"lifecycleKey":"refundRequestNo","defaultVisible":true} |
| 29 | 记录创建时间 | CREATED_AT | 否 | {"lifecycleKey":"createdAt","defaultVisible":true} |
| 30 | 最近更新记录 | UPDATED_AT | 否 | {"lifecycleKey":"updatedAt","defaultVisible":true} |
| 31 | 备注 | TEXT | 否 | {"lifecycleKey":"remark","defaultVisible":true} |
| 32 | 退费办理状态 | SINGLE_SELECT | 是 | {"lifecycleKey":"status","defaultVisible":false,"choices":[{"id":"OPEN","name":"待办理"},{"id":"CANCELLED","name":"已取消"}]} |
| 33 | 合同编号（同步） | TEXT | 否 | {"lifecycleKey":"contractNo","defaultVisible":false} |
| 34 | 案件编号（同步） | TEXT | 否 | {"lifecycleKey":"caseNo","defaultVisible":false} |
| 35 | 案件名称（同步） | TEXT | 否 | {"lifecycleKey":"caseTitle","defaultVisible":false} |
| 36 | 合同金额（同步） | CURRENCY | 否 | {"lifecycleKey":"contractAmount","defaultVisible":false} |

## MEDICAL_ASSESSMENT — 病例评估表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/follow-support-templates.ts)；21 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | ID | TEXT | 是 | {"primary":true} |
| 2 | 患者姓名 | TEXT | 否 | {} |
| 3 | 委托人 | TEXT | 否 | {} |
| 4 | 微信名 | TEXT | 否 | {} |
| 5 | 抖音号 | TEXT | 否 | {} |
| 6 | 联系电话 | TEXT | 否 | {} |
| 7 | 地区 | TEXT | 否 | {} |
| 8 | 客资等级 | MULTI_SELECT | 否 | {"choices":[{"id":"A级","name":"A级"},{"id":"B级","name":"B级"},{"id":"C级","name":"C级"},{"id":"D级","name":"D级"},{"id":"否","name":"否"}]} |
| 9 | 谈案人 | USER | 否 | {} |
| 10 | 案件评估 | FILE | 否 | {} |
| 11 | 案件评估 (1) | FILE | 否 | {} |
| 12 | 医疗记录（病历） | FILE | 否 | {} |
| 13 | 医疗记录（整理后） | FILE | 否 | {} |
| 14 | 录音、附件 | FILE | 否 | {} |
| 15 | 付款金额 | CURRENCY | 否 | {} |
| 16 | 收费方式 | SINGLE_SELECT | 否 | {"choices":[{"id":"转账","name":"转账"},{"id":"扫码大数据（福掌柜）","name":"扫码大数据（福掌柜）"},{"id":"扫码律所公账","name":"扫码律所公账"},{"id":"¥399.00","name":"¥399.00"},{"id":"退费","name":"退费"}]} |
| 17 | 收款时间 | DATETIME | 否 | {} |
| 18 | 是否交付 | SINGLE_SELECT | 否 | {"choices":[{"id":"是","name":"是"},{"id":"否","name":"否"},{"id":"@陈红利","name":"@陈红利"},{"id":"2026/09/24","name":"2026/09/24"}]} |
| 19 | 交付时间 | DATETIME | 否 | {} |
| 20 | 跟进记录 | TEXT | 否 | {} |
| 21 | 备注 | TEXT | 否 | {} |

## SIGNING_CONVERSION — 签约转化表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/follow-support-templates.ts)；36 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 签约ID | TEXT | 是 | {"primary":true} |
| 2 | 客户姓名 | TEXT | 否 | {} |
| 3 | 案由 | TEXT | 否 | {} |
| 4 | 线索ID | RELATION | 否 | {"targetSource":"LEADS"} |
| 5 | 来源渠道ID | RELATION | 否 | {"targetSource":"CHANNELS"} |
| 6 | 谈案人 | USER | 否 | {} |
| 7 | 谈案辅助人 | TEXT | 否 | {} |
| 8 | 承办律师 | TEXT | 否 | {} |
| 9 | 成交类型 | SINGLE_SELECT | 否 | {"choices":[{"id":"新签","name":"新签"},{"id":"复购","name":"复购"},{"id":"转介绍成交","name":"转介绍成交"},{"id":"尾款","name":"尾款"}]} |
| 10 | 是否签约 | BOOLEAN | 否 | {} |
| 11 | 签约日期 | DATETIME | 否 | {} |
| 12 | 签约金额 | CURRENCY | 否 | {} |
| 13 | 代理费收款方式 | SINGLE_SELECT | 否 | {"choices":[{"id":"常规代理","name":"常规代理"},{"id":"全风险代理","name":"全风险代理"},{"id":"半风险代理","name":"半风险代理"},{"id":"分段支付","name":"分段支付"}]} |
| 14 | 是否分期 | BOOLEAN | 否 | {} |
| 15 | 分期说明 | TEXT | 否 | {} |
| 16 | 首付款金额 | CURRENCY | 否 | {} |
| 17 | 二次付款金额 | CURRENCY | 否 | {} |
| 18 | 二次收款时间 | TEXT | 否 | {} |
| 19 | 三次付款金额 | CURRENCY | 否 | {} |
| 20 | 四次付款金额 | CURRENCY | 否 | {} |
| 21 | 付款方式 | SINGLE_SELECT | 否 | {"choices":[{"id":"扫码支付","name":"扫码支付"},{"id":"刷卡支付","name":"刷卡支付"},{"id":"扫码","name":"扫码"},{"id":"转公账","name":"转公账"}]} |
| 22 | 固定代理费金额 | CURRENCY | 否 | {} |
| 23 | 半风险案件基础代理费 | CURRENCY | 否 | {} |
| 24 | 风险代理比例 | TEXT | 否 | {} |
| 25 | 风险代理金额 | CURRENCY | 否 | {} |
| 26 | 是否进入二销 | BOOLEAN | 否 | {} |
| 27 | 财务收款状态 | SINGLE_SELECT | 否 | {"choices":[]} |
| 28 | 委托合同 | FILE | 否 | {} |
| 29 | 合同生成状态 | SINGLE_SELECT | 否 | {"choices":[]} |
| 30 | 案件建档状态 | SINGLE_SELECT | 否 | {"choices":[{"id":"已归档","name":"已归档"},{"id":"已办结、未归档","name":"已办结、未归档"},{"id":"案件办理中","name":"案件办理中"}]} |
| 31 | 归档编号 | TEXT | 否 | {} |
| 32 | 特别约定 | TEXT | 否 | {} |
| 33 | 下次联系时间 | DATETIME | 否 | {} |
| 34 | 最后操作人 | UPDATED_BY | 否 | {} |
| 35 | 最后操作时间 | UPDATED_AT | 否 | {} |
| 36 | 备注 | TEXT | 否 | {} |

## LAWYER_PROSPECTS — 律师客资表

[源码](../../../LayerManage/law-firm-system/apps/server/app/application/collaboration/lawyer-prospect-template.ts)；24 个标准字段。

| 顺序 | 字段 | 类型 | 模板必填 | 选项与来源规则 |
|---|---|---|---|---|
| 1 | 创建时间 | CREATED_AT | 否 | {} |
| 2 | 客资来源 | SINGLE_SELECT | 否 | {"choices":[{"id":"视频号","name":"视频号"},{"id":"抖音","name":"抖音"}]} |
| 3 | 联系方式 | TEXT | 否 | {"maskDisplay":true,"helpText":"列表默认脱敏显示；有编辑权限时可查看和修改原值。共享权限决定数据访问范围。"} |
| 4 | 客户网名 | TEXT | 否 | {} |
| 5 | 客户姓名 | TEXT | 是 | {"primary":true} |
| 6 | 地区 | TEXT | 否 | {} |
| 7 | 对话聊天记录 | LONG_TEXT | 否 | {} |
| 8 | 跟进人 | LONG_TEXT | 否 | {} |
| 9 | 跟进方式 | MULTI_SELECT | 否 | {"choices":[{"id":"已添加微信","name":"已添加微信"},{"id":"已申请微信","name":"已申请微信"},{"id":"已电联","name":"已电联"}]} |
| 10 | 标的范围 | SINGLE_SELECT | 否 | {"choices":[{"id":"1万以下","name":"1万以下"},{"id":"1万—3万","name":"1万—3万"},{"id":"3万—10万","name":"3万—10万"},{"id":"10万以上","name":"10万以上"}]} |
| 11 | 案件类型 | SINGLE_SELECT | 否 | {"choices":[{"id":"借款合同纠纷","name":"借款合同纠纷"},{"id":"劳动纠纷","name":"劳动纠纷"},{"id":"侵权纠纷","name":"侵权纠纷"},{"id":"婚姻家事","name":"婚姻家事"},{"id":"刑事案件","name":"刑事案件"},{"id":"人格权纠纷","name":"人格权纠纷"},{"id":"物权纠纷","name":"物权纠纷"},{"id":"知识产权纠纷","name":"知识产权纠纷"},{"id":"海事海商纠纷","name":"海事海商纠纷"},{"id":"公司股权","name":"公司股权"},{"id":"证券","name":"证券"},{"id":"票据纠纷","name":"票据纠纷"},{"id":"非诉","name":"非诉"},{"id":"执行","name":"执行"},{"id":"租赁合同纠纷","name":"租赁合同纠纷"},{"id":"合伙合同纠纷","name":"合伙合同纠纷"},{"id":"建设工程施工合同","name":"建设工程施工合同"},{"id":"其它类合同纠纷","name":"其它类合同纠纷"},{"id":"劳务费","name":"劳务费"},{"id":"工伤","name":"工伤"},{"id":"交通事故","name":"交通事故"}]} |
| 12 | 案件价值等级 | MULTI_SELECT | 否 | {"choices":[{"id":"A级（律所区域+标的3w以上）","name":"A级（律所区域+标的3w以上）"},{"id":"B级（律所区域+标的1万-3万）","name":"B级（律所区域+标的1万-3万）"},{"id":"C级（客资在三天不同时间段5通电话未接）","name":"C级（客资在三天不同时间段5通电话未接）"},{"id":"D级（无效案件，行政诉讼、土地纠纷、林地纠纷、70岁以上、上访户、标的一万以下）","name":"D级（无效案件，行政诉讼、土地纠纷、林地纠纷、70岁以上、上访户、标的一万以下）"},{"id":"E级（执行案件）","name":"E级（执行案件）"}]} |
| 13 | 客户状态 | SINGLE_SELECT | 否 | {"choices":[{"id":"未跟进","name":"未跟进"},{"id":"未联系上","name":"未联系上"},{"id":"已邀约","name":"已邀约"},{"id":"待邀约","name":"待邀约"},{"id":"已到访","name":"已到访"},{"id":"已成交","name":"已成交"},{"id":"未按时到访","name":"未按时到访"},{"id":"待进一步沟通","name":"待进一步沟通"},{"id":"放弃","name":"放弃"},{"id":"纯咨询","name":"纯咨询"},{"id":"报价促单","name":"报价促单"}]} |
| 14 | 最后更新时间 | UPDATED_AT | 否 | {} |
| 15 | 下次跟进时间 | DATETIME | 否 | {} |
| 16 | 后续跟进事项 | LONG_TEXT | 否 | {} |
| 17 | 预约到访日期 | DATETIME | 否 | {} |
| 18 | 到访地点 | SINGLE_SELECT | 否 | {"choices":[{"id":"铜梁分所","name":"铜梁分所"},{"id":"重庆总所","name":"重庆总所"},{"id":"万州分所","name":"万州分所"},{"id":"绵阳分所","name":"绵阳分所"},{"id":"黔江律所","name":"黔江律所"}]} |
| 19 | 合约代理费 | CURRENCY | 否 | {} |
| 20 | 风险代理比例 | NUMBER | 否 | {} |
| 21 | 委托合同 | FILE | 否 | {} |
| 22 | 案件材料、录音链接 | FILE | 否 | {} |
| 23 | 谈案人 | LONG_TEXT | 否 | {} |
| 24 | 线下谈案报告 | FILE | 否 | {} |
