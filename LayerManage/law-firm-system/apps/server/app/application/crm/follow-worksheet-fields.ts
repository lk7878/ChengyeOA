export const followChoices: Record<string, { id: string; name: string }[]> = Object.fromEntries(
  Object.entries({
    customerStage:
      '患者在治疗阶段,家属在收集证据,封存病历,已发材料,主动来电,沟通详情,已报价,已约面,推199,已面谈,咨询,已转199,推599,已转299,收集病例,一转,收集材料,推299,案情沟通',
    currentStage:
      '指导封存病历,搜集完整材料,没联系上客户,已委托了律师,已发律所定位,待下次详细沟通,待转199,纯咨询,客户封存病历中,已转199,待下次邀约,未接通,已转399,已委托,待成交,待进一步沟通,已一转,转599,待转299,已约面,已面谈,已转299,待转399,已转599,待一转,已成交,邀约上门,已到所,推指导,已报价促单,已付咨询费,无效,待转599,推399',
    followRole: '客服,邀约,谈案人,助理',
    result:
      '持续沟通,预约中,待报价,已报价,成交,未成交,无效,成交199,已到所,未接通,5.26晚发病历,咨询,待转599,转299,已转299,已约面,待转200,无需求',
    caseTypes: '刑事,医疗,综合,婚姻,医美,合同,侵权,劳动',
  }).map(([key, values]) => [key, values.split(',').map((name) => ({ id: name, name }))]),
);
export const followColumns = [
  ['followNo', '跟进记录ID', 'TEXT'],
  ['customerName', '客户名称', 'TEXT'],
  ['wechat', '微信名', 'TEXT'],
  ['douyinName', '抖音名', 'TEXT'],
  ['phone', '电话', 'PHONE'],
  ['region', '地区', 'TEXT'],
  ['leadId', '线索ID', 'TEXT'],
  ['concerns', '客户关注点', 'TEXT'],
  ['objections', '客户异议点', 'TEXT'],
  ['customerStage', '客户阶段', 'SINGLE_SELECT'],
  ['currentStage', '当前阶段', 'SINGLE_SELECT'],
  ['followedBy', '跟进人', 'USER'],
  ['lastFollowBy', '最后跟进人', 'USER'],
  ['lastOperator', '最后操作人', 'USER'],
  ['followRole', '跟进角色', 'SINGLE_SELECT'],
  ['type', '跟进方式', 'SINGLE_SELECT'],
  ['result', '跟进结果', 'SINGLE_SELECT'],
  ['content', '跟进记录', 'LONG_TEXT'],
  ['summary', '沟通摘要', 'TEXT'],
  ['caseTypes', '案件类型', 'MULTI_SELECT'],
  ['nextPlan', '下次跟进事项', 'LONG_TEXT'],
  ['nextTime', '下次跟进时间', 'DATETIME'],
  ['enteredAt', '录入时间', 'DATETIME'],
  ['updatedAt', '最后跟进时间', 'DATETIME'],
  ['dropAt', '掉库时间', 'DATETIME'],
  ['overdue', '是否超期未跟', 'BOOLEAN'],
  ['changes', '变更内容', 'TEXT'],
  ['attachments', '附件/录音', 'FILE'],
];
export const followReadonly = [
  'followNo',
  'leadId',
  'lastFollowBy',
  'lastOperator',
  'updatedAt',
  'createdBy',
  'createdAt',
];
export const followCoreKeys = ['type', 'content', 'nextPlan', 'nextTime', 'enteredAt'];
export const followEditable = followColumns
  .map(([key]) => key)
  .filter((key) => !followReadonly.includes(key));
export const followProfileKeys = followEditable.filter((key) => !followCoreKeys.includes(key));
