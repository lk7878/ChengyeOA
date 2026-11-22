/** Labels only: identifiers and API payloads retain their original values. */
const labels: Record<string, string> = {
  ENABLED: '启用', DISABLED: '停用', ACTIVE: '有效', INACTIVE: '无效', LOCKED: '已锁定',
  PENDING: '待处理', APPROVED: '已通过', REJECTED: '已拒绝', WITHDRAWN: '已撤回', CANCELLED: '已取消',
  PENDING_REVIEW: '待审核', PENDING_POST_REVIEW: '待事后复核', EXECUTING: '执行中', RUNNING: '运行中',
  SUCCEEDED: '执行成功', FAILED: '失败', CONFIRMED: '已复核', FLAGGED: '已标记异常',
  APPROVE: '同意', REJECT: '拒绝', CONFIRM: '确认', FLAG: '标记异常', PRE: '事前审核', POST: '事后审核',
  REVOKED: '已撤销', EXPIRED: '已过期', SCHEDULED: '待生效', NOT_YET_VALID: '尚未生效',
  HIGH: '高风险', MEDIUM: '中风险', LOW: '低风险', CRITICAL: '极高风险',
  ACTION: '操作权限',
  organization: '组织', position: '岗位', employee: '员工', employee_assignment: '员工任职', professional_team: '专业团队', professional_team_member: '团队成员', user: '用户', role: '角色',
  lead: '线索', customer: '客户', negotiation: '谈案', contract: '合同', case: '案件', payment: '收款', invoice: '开票', refund: '退款', cost: '成本', approval: '审批', notification: '通知', performance: '绩效', channel: '渠道',
  ROLE: '角色', USER: '用户', SYSTEM: '系统', BUSINESS: '业务角色', SPECIAL: '特殊权限', MENU: '菜单', BUTTON: '按钮',
  SYSTEM_ADMIN: '系统管理员', SYSTEM_SUPER_ADMIN: '超级管理员', DIRECT: '直接授权', TEMPORARY: '临时授权', PERMANENT: '长期授权',
  ALL: '全所', HQ_SCOPE: '总所范围', ORG: '指定组织', BRANCH: '指定分所', TEAM: '指定团队',
  SELF_AND_SUBORDINATES: '本人及下属', SELF: '本人', NONE: '不可读取', MASKED: '脱敏读取', READ: '完整读取',
  PUBLIC: '公开', NORMAL: '普通', INTERNAL: '内部', SENSITIVE: '敏感', HIGH_SENSITIVE: '高度敏感', HIGHLY_SENSITIVE: '高度敏感',
  ORGANIZATION: '组织', POSITION: '岗位', EMPLOYEE: '员工', PROFESSIONAL_TEAM: '专业团队',
  MANUAL: '人工任务', AUTO: '自动任务', APPROVAL: '审批节点', TASK: '任务节点', START: '开始节点', END: '结束节点',
  PHONE: '电话', CALL: '电话', WECHAT: '微信', EMAIL: '邮件', MEETING: '会议', VISIT: '当面沟通', FACE_TO_FACE: '当面沟通', OTHER: '其他',
  DRAFT: '草稿', TODO: '待办', IN_PROGRESS: '进行中', COMPLETED: '已完成', CLOSED: '已关闭', ARCHIVED: '已归档',
  L1: '一级数据', L2: '二级数据', L3: '三级数据', L4: '四级数据', FORBIDDEN: '禁止访问', SPECIAL_GRANT: '临时特权授权', CONTRACT_READ_GRANT: '单份合同只读授权', SINGLE_CONTRACT: '指定合同', CUSTOM: '自定义范围',
  PASSWORD: '密码验证', MFA: '二次验证', TOTP: '身份验证器', RECOVERY_CODE: '恢复码',
};
export function businessLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return Object.hasOwn(labels, String(value)) ? labels[String(value)] : String(value);
}

export const POSITION_CATEGORIES = [
  { value: 'LEGAL', label: '法律专业' }, { value: 'LAWYER', label: '律师' },
  { value: 'MANAGEMENT', label: '管理' }, { value: 'ADMIN', label: '行政' },
  { value: 'FINANCE', label: '财务' }, { value: 'HR', label: '人事' },
  { value: 'MARKETING', label: '市场拓展' }, { value: 'IT', label: '信息技术' },
  { value: 'ASSISTANT', label: '助理' }, { value: 'INTERN', label: '实习' },
  { value: 'OTHER', label: '其他' },
];
const categories: Record<string, string> = {
  ...Object.fromEntries(POSITION_CATEGORIES.map(item => [item.value, item.label])),
  LEGACY: '历史分类', MEDICAL: '医疗法律', CIVIL: '民商事', CRIMINAL: '刑事', LABOR: '劳动法律',
  CORPORATE: '公司法律', LITIGATION: '诉讼', NON_LITIGATION: '非诉业务', REAL_ESTATE: '房地产法律',
};
export function categoryLabel(code: string): string {
  if (Object.hasOwn(categories, code)) return categories[code];
  const department = /^DEPT_?(\d+)$/i.exec(code);
  if (department) return `部门岗位 ${department[1]}`;
  if (/[\u3400-\u9fff]/.test(code)) return code;
  return '历史自定义分类';
}
export function positionCodeLabel(code: string, name = '岗位'): string {
  const match = /^(?:DEPART|DEPT|GW)_?(\d+)$/i.exec(code);
  if (match) return `岗位编号 ${match[1]}`;
  const suffix = /(?:_|^)(\d+)$/.exec(code);
  return suffix ? `${name}编号 ${suffix[1]}` : `${name}内部编号`;
}
export function newPositionCode(): string {
  const random = new Uint32Array(1); crypto.getRandomValues(random);
  return `GW_${Date.now()}${String(random[0]).padStart(10, '0')}`;
}
