import { Prisma } from '@prisma/client';

export const followSupportKinds = ['MEDICAL_ASSESSMENT', 'SIGNING_CONVERSION'] as const;
export type FollowSupportKind = (typeof followSupportKinds)[number];
type Definition = [string, string, string?];
const definitions: Record<FollowSupportKind, Definition[]> = {
  MEDICAL_ASSESSMENT: [
    ['ID', 'TEXT'],
    ['患者姓名', 'TEXT'],
    ['委托人', 'TEXT'],
    ['微信名', 'TEXT'],
    ['抖音号', 'TEXT'],
    ['联系电话', 'TEXT'],
    ['地区', 'TEXT'],
    ['客资等级', 'MULTI_SELECT', 'A级|B级|C级|D级|否'],
    ['谈案人', 'USER'],
    ['案件评估', 'FILE'],
    ['案件评估 (1)', 'FILE'],
    ['医疗记录（病历）', 'FILE'],
    ['医疗记录（整理后）', 'FILE'],
    ['录音、附件', 'FILE'],
    ['付款金额', 'CURRENCY'],
    ['收费方式', 'SINGLE_SELECT', '转账|扫码大数据（福掌柜）|扫码律所公账|¥399.00|退费'],
    ['收款时间', 'DATETIME'],
    ['是否交付', 'SINGLE_SELECT', '是|否|@陈红利|2026/09/24'],
    ['交付时间', 'DATETIME'],
    ['跟进记录', 'TEXT'],
    ['备注', 'TEXT'],
  ],
  SIGNING_CONVERSION: [
    ['签约ID', 'TEXT'],
    ['客户姓名', 'TEXT'],
    ['案由', 'TEXT'],
    ['线索ID', 'RELATION', 'LEADS'],
    ['来源渠道ID', 'RELATION', 'CHANNELS'],
    ['谈案人', 'USER'],
    ['谈案辅助人', 'TEXT'],
    ['承办律师', 'TEXT'],
    ['成交类型', 'SINGLE_SELECT', '新签|复购|转介绍成交|尾款'],
    ['是否签约', 'BOOLEAN'],
    ['签约日期', 'DATETIME'],
    ['签约金额', 'CURRENCY'],
    ['代理费收款方式', 'SINGLE_SELECT', '常规代理|全风险代理|半风险代理|分段支付'],
    ['是否分期', 'BOOLEAN'],
    ['分期说明', 'TEXT'],
    ['首付款金额', 'CURRENCY'],
    ['二次付款金额', 'CURRENCY'],
    ['二次收款时间', 'TEXT'],
    ['三次付款金额', 'CURRENCY'],
    ['四次付款金额', 'CURRENCY'],
    ['付款方式', 'SINGLE_SELECT', '扫码支付|刷卡支付|扫码|转公账'],
    ['固定代理费金额', 'CURRENCY'],
    ['半风险案件基础代理费', 'CURRENCY'],
    ['风险代理比例', 'TEXT'],
    ['风险代理金额', 'CURRENCY'],
    ['是否进入二销', 'BOOLEAN'],
    ['财务收款状态', 'SINGLE_SELECT'],
    ['委托合同', 'FILE'],
    ['合同生成状态', 'SINGLE_SELECT'],
    ['案件建档状态', 'SINGLE_SELECT', '已归档|已办结、未归档|案件办理中'],
    ['归档编号', 'TEXT'],
    ['特别约定', 'TEXT'],
    ['下次联系时间', 'DATETIME'],
    ['最后操作人', 'UPDATED_BY'],
    ['最后操作时间', 'UPDATED_AT'],
    ['备注', 'TEXT'],
  ],
};
export const followSupportNames: Record<FollowSupportKind, string> = {
  MEDICAL_ASSESSMENT: '病例评估表',
  SIGNING_CONVERSION: '签约转化表',
};
export function followSupportFields(kind: FollowSupportKind) {
  return definitions[kind].map(([name, type, contents], position) => {
    const options: Record<string, Prisma.InputJsonValue | undefined> =
      position === 0 ? { primary: true } : {};
    if (type.endsWith('_SELECT'))
      options.choices = (contents ? contents.split('|') : []).map((name) => ({ id: name, name }));
    if (type === 'RELATION') options.targetSource = contents;
    return { name, type, position, required: position === 0, options };
  });
}
