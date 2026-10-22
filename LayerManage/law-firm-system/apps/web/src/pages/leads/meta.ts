// SPEC-009 Task 11: CRM 展示元数据（状态文案/颜色），线索各页面共享。
import type {
  AppointmentChannel,
  AppointmentStatus,
  CustomerStatus,
  CustomerType,
  LeadFollowType,
  LeadSourceType,
  LeadStatus,
  PoolStatus,
} from '@/api/types';

export const LEAD_STATUS_META: Record<LeadStatus, { text: string; color: string }> = {
  NEW: { text: '新建', color: 'blue' },
  ASSIGNED: { text: '已分配', color: 'cyan' },
  CONTACTED: { text: '已联系', color: 'geekblue' },
  SCREENED: { text: '已筛选', color: 'orange' },
  INVITED: { text: '已邀约', color: 'purple' },
  VISITED: { text: '已到访', color: 'magenta' },
  CONVERTED: { text: '已转化', color: 'green' },
  LOST: { text: '已流失', color: 'default' },
  NURTURE: { text: '培育中', color: 'gold' },
};

export const POOL_STATUS_META: Record<PoolStatus, { text: string; color: string }> = {
  PUBLIC: { text: '公海', color: 'green' },
  PRIVATE: { text: '私海', color: 'blue' },
  RECYCLED: { text: '回收池', color: 'orange' },
};

export const SOURCE_TYPE_META: Record<LeadSourceType, string> = {
  MANUAL: '手工录入',
  CAMPAIGN: '市场活动',
  REFERRAL: '转介绍',
  NATURAL: '自然到访',
  OFFLINE: '线下渠道',
};

export const FOLLOW_TYPE_META: Record<LeadFollowType, string> = {
  PHONE: '电话',
  WECHAT: '微信',
  VISIT: '面谈',
  ONLINE: '线上会议',
  SMS: '短信',
  OTHER: '其他',
};

export const APPOINTMENT_CHANNEL_META: Record<AppointmentChannel, string> = {
  ONSITE: '到访',
  ONLINE: '线上',
};

export const APPOINTMENT_STATUS_META: Record<AppointmentStatus, { text: string; color: string }> = {
  PENDING: { text: '待确认', color: 'blue' },
  CONFIRMED: { text: '已确认', color: 'cyan' },
  VISITED: { text: '已到访', color: 'green' },
  NOSHOW: { text: '爽约', color: 'red' },
  CANCELLED: { text: '已取消', color: 'default' },
  RESCHEDULED: { text: '已改期', color: 'orange' },
};

export const CUSTOMER_STATUS_META: Record<CustomerStatus, { text: string; color: string }> = {
  POTENTIAL: { text: '潜在客户', color: 'blue' },
  INTENT: { text: '意向客户', color: 'orange' },
  SIGNED: { text: '已签约', color: 'green' },
  INACTIVE: { text: '流失', color: 'default' },
};

export const CUSTOMER_TYPE_META: Record<CustomerType, string> = {
  INDIVIDUAL: '个人',
  ENTERPRISE: '企业',
};

/** 意向等级星级展示（1-5）。 */
export function intentionStars(level: number): string {
  const safe = Math.max(0, Math.min(5, Math.round(level)));
  return `${'★'.repeat(safe)}${'☆'.repeat(5 - safe)}`;
}
