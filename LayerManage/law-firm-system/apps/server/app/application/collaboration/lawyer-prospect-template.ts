import { Prisma } from '@prisma/client';

export const lawyerProspectTemplate = 'LAWYER_PROSPECTS';
export const lawyerProspectNames = ['李辉律师客资表', '张恒溢律师客资表'];

/** 20261103: the numbered specification contains 24 unique fields. */
export function lawyerProspectFields() {
  const definitions: [string, string, string?][] = [
    ['创建时间', 'CREATED_AT'],
    ['客资来源', 'SINGLE_SELECT', '视频号|抖音'],
    ['联系方式', 'TEXT'],
    ['客户网名', 'TEXT'],
    ['客户姓名', 'TEXT'],
    ['地区', 'TEXT'],
    ['对话聊天记录', 'LONG_TEXT'],
    ['跟进人', 'LONG_TEXT'],
    ['跟进方式', 'MULTI_SELECT', '已添加微信|已申请微信|已电联'],
    ['标的范围', 'SINGLE_SELECT', '1万以下|1万—3万|3万—10万|10万以上'],
    ['案件类型', 'SINGLE_SELECT', '借款合同纠纷|劳动纠纷|侵权纠纷|婚姻家事|刑事案件|人格权纠纷|物权纠纷|知识产权纠纷|海事海商纠纷|公司股权|证券|票据纠纷|非诉|执行|租赁合同纠纷|合伙合同纠纷|建设工程施工合同|其它类合同纠纷|劳务费|工伤|交通事故'],
    ['案件价值等级', 'MULTI_SELECT', 'A级（律所区域+标的3w以上）|B级（律所区域+标的1万-3万）|C级（客资在三天不同时间段5通电话未接）|D级（无效案件，行政诉讼、土地纠纷、林地纠纷、70岁以上、上访户、标的一万以下）|E级（执行案件）'],
    ['客户状态', 'SINGLE_SELECT', '未跟进|未联系上|已邀约|待邀约|已到访|已成交|未按时到访|待进一步沟通|放弃|纯咨询|报价促单'],
    ['最后更新时间', 'UPDATED_AT'],
    ['下次跟进时间', 'DATETIME'],
    ['后续跟进事项', 'LONG_TEXT'],
    ['预约到访日期', 'DATETIME'],
    ['到访地点', 'SINGLE_SELECT', '铜梁分所|重庆总所|万州分所|绵阳分所|黔江律所'],
    ['合约代理费', 'CURRENCY'],
    ['风险代理比例', 'NUMBER'],
    ['委托合同', 'FILE'],
    ['案件材料、录音链接', 'FILE'],
    ['谈案人', 'LONG_TEXT'],
    ['线下谈案报告', 'FILE'],
  ];
  return definitions.map(([name, type, choices], position) => {
    const options: Record<string, Prisma.InputJsonValue> = {};
    if (choices) options.choices = choices.split('|').map(name => ({ id: name, name }));
    if (name === '客户姓名') options.primary = true;
    if (name === '联系方式') {
      options.helpText = '共享权限决定数据访问范围；有查看权限时显示完整联系方式。';
    }
    return { name, type, position, required: name === '客户姓名', options };
  });
}
