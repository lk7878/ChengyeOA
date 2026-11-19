// Shared case intake specification. Keep web/server definitions aligned.
export const INTAKE_FIELDS = [
  ['signedDate', '签约日期', 'datetime', '基本信息'],
  ['contractNumber', '合同编号', 'text', '基本信息'],
  ['region', '地区', 'text', '基本信息'],
  ['customerPhone', '客户电话', 'text', '基本信息'],
  ['caseCategory', '案件类型', 'select', '基本信息'],
  ['agencyProcedure', '代理程序', 'multi', '基本信息'],
  ['customProcedure', '自定义代理程序', 'text', '基本信息'],
  ['departmentId', '关联组织部门', 'department', '基本信息'],
  ['feeCollectionMethod', '代理费收款方式', 'select', '收费约定'],
  ['fixedAgencyFee', '固定代理费金额', 'money', '收费约定'],
  ['baseAgencyFee', '案件基础代理费', 'money', '收费约定'],
  ['riskAgencyAmount', '风险代理金额', 'money', '收费约定'],
  ['riskAgencyRatio', '风险代理比例', 'ratio', '收费约定'],
  ['paymentTerms', '代理费付款特别约定', 'textarea', '收费约定'],
  ['firstPaymentAmount', '首次代理费', 'number', '到款退款'],
  ['firstPaymentDate', '首次收款日期', 'datetime', '到款退款'],
  ['secondPaymentAmount', '二次到款金额', 'number', '到款退款'],
  ['secondPaymentDate', '二次到款金额时间', 'datetime', '到款退款'],
  ['thirdPaymentAmount', '三次到款金额', 'money', '到款退款'],
  ['thirdPaymentDate', '三次到款金额时间', 'datetime', '到款退款'],
  ['fourthPaymentAmount', '四次到款金额', 'number', '到款退款'],
  ['fourthPaymentDate', '四次到款金额时间', 'datetime', '到款退款'],
  ['totalReceivedAmount', '总到款金额', 'money', '到款退款'],
  ['refundAmount', '退费金额', 'money', '到款退款'],
  ['refundDate', '退款时间', 'datetime', '到款退款'],
  ['afterThirdPaymentAmount', '到款次数三次以上金额总和', 'money', '到款退款'],
  ['lastPaymentDate', '最后一次到款时间', 'datetime', '到款退款'],
  ['lawyerCommissionAmount', '律师提成金额', 'formulaMoney', '律师提成'],
  ['lawyerCommissionRatio', '律师提成比例', 'formulaRatio', '律师提成'],
  ['customerNumber', '客户编号', 'text', '客户信息'],
  ['customerIdentity', '客户的身份类型', 'select', '客户信息'],
  ['customerSource', '客资来源', 'select', '客户信息'],
  ['opposingParty', '对方当事人', 'text', '案件信息'],
  ['caseStage', '案件阶段', 'text', '案件信息'],
  ['limitationPeriod', '案件时效', 'text', '案件信息'],
  ['claimAmount', '案件标的额', 'number', '案件信息'],
  ['claimScope', '标的范围', 'text', '案件信息'],
  ['businessDepartment', '所属业务部门', 'select', '案件信息'],
  ['owningLawyer', '所属律师', 'text', '案件信息'],
  ['handlingLawyer', '承办律师', 'user', '案件信息'],
  ['negotiatorId', '谈案人', 'user', '案件信息'],
  ['assistantNegotiator', '帮谈人', 'text', '案件信息'],
  ['assistantCommissionRatio', '帮谈人提成比例', 'text', '案件信息'],
  ['negotiatorCommissionRatio', '谈案人提成比例', 'text', '案件信息'],
  ['serviceDeadline', '服务期限', 'datetime', '基本信息'],
  ['payeeId', '收款人', 'user', '到款退款'],
  ['receiptMethod', '收款方式', 'multi', '到款退款'],
  ['receiptAccount', '收款账户', 'multi', '到款退款'],
  ['receiptReference', '收款流水编号', 'text', '到款退款'],
  ['bankReceiptDate', '银行到账日期', 'datetime', '到款退款'],
  ['installment', '分期付款案件', 'boolean', '到款退款'],
  ['managementFeeRatio', '律所管理费比例', 'integerRatio', '律师提成'],
  ['invoiced', '是否已开票', 'select', '开票信息'],
  ['invoiceNumber', '发票号码', 'text', '开票信息'],
  ['invoiceAmount', '发票金额', 'number', '开票信息'],
  ['terminated', '是否解除合同', 'select', '到款退款'],
  ['nextPaymentDate', '预计下次补款时间', 'datetime', '到款退款'],
  ['conversionStaffId', '销转人员', 'user', '案件信息'],
  ['contractMissing', '合同未回', 'boolean', '基本信息'],
  ['remark', '备注', 'text', '基本信息'],
  ['materialLink', '案件材料链接', 'text', '案件信息'],
  ['actualManagementFee', '实际律所管理费', 'formulaNumber', '律师提成'],
  ['fixedGuarantee', '固定质保金', 'formulaMoney', '律师提成'],
  ['proportionalGuarantee', '比例质保金', 'formulaRatio', '律师提成'],
  ['actualGuaranteeDeduction', '实际保证金扣除数', 'formulaNumber', '律师提成'],
  ['monthlyReceipt', '当月实收金额', 'formulaMoney', '到款退款'],
  ['outstandingAmount', '待补款金额', 'formulaNumber', '到款退款'],
] as const;
export const INTAKE_OPTIONS: Record<string, readonly string[]> = {
  caseCategory: ['刑事', '民事', '行政', '商事', '执行', '国家赔偿', '法律援助', '非诉'],
  agencyProcedure: [
    '一审',
    '二审',
    '执行',
    '再审',
    '刑事侦查',
    '审查起诉',
    '行政复议',
    '和解',
    '调解',
    '代书',
    '其他非诉',
    '刑事会见',
    '仲裁代理出庭',
    '仲裁',
    '常年法律顾问',
    '代为申请立案',
    '工伤认定程序',
    '陪同刑事控告',
    '申请执行',
    '咨询费',
  ],
  feeCollectionMethod: ['半风险代理', '法律援助', '分段付款', '常规代理', '全风险代理'],
  customerIdentity: [
    '个体经营者',
    '家庭主妇',
    '建筑承包商',
    '工厂工人',
    '企业员工',
    '在校学生',
    '公司员工',
    '自由职业者',
    '个体工商户',
    '企业法人',
  ],
  customerSource: [
    '律师个人',
    '老客户转介绍',
    '同行转介绍',
    '微信公众号视频号',
    '抖音',
    '快手',
    '小红书',
    '高德',
    '美团',
    '其他',
  ],
  businessDepartment: ['律所', '大数据中心', '侵权中心', '律师部', '门市'],
  receiptMethod: ['转账', '扫码（富友）', '扫码（嘉联）', '现金'],
  receiptAccount: ['华夏', '招商', '民生', '支付宝'],
  invoiced: ['否', '是'],
  terminated: ['是', '否'],
};
export type IntakeKey = (typeof INTAKE_FIELDS)[number][0];
export type CaseIntake = Partial<Record<IntakeKey, string>>;
export const ATTACHMENT_CATEGORIES = [
  '合同附件',
  '收款凭证',
  '退款凭证',
  '对话聊天记录',
  '案情报告',
] as const;
export interface IntakeAttachment {
  fileName: string;
  fileType: string;
  base64: string;
  category: (typeof ATTACHMENT_CATEGORIES)[number];
}
// Legacy single selections remain readable; new multiple selections use JSON strings.
export function intakeSelections(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value) return [];
  if (value.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed;
    } catch {
      /* validation rejects malformed values */
    }
  }
  return [value];
}

export const CASE_FIELD_ORDER = [
  'contractDisplayId', 'intake.contractMissing', 'intake.signedDate', 'intake.contractNumber',
  'customerName', 'intake.region', 'intake.customerPhone', 'intake.opposingParty',
  'intake.caseCategory', 'caseType', 'intake.agencyProcedure', 'intake.feeCollectionMethod',
  'intake.fixedAgencyFee', 'intake.baseAgencyFee', 'intake.riskAgencyAmount', 'intake.riskAgencyRatio',
  'intake.paymentTerms', 'intake.businessDepartment', 'lawyerId', 'intake.handlingLawyer', 'files.合同附件',
  'receiptDetails', 'receiptTotal', 'receiptFiles', 'createdAt', 'updatedAt', 'intake.remark',
];

export const FORMULA_KEYS = INTAKE_FIELDS.filter((field) => field[2].startsWith('formula')).map(
  (field) => field[0],
);
