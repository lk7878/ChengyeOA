// SPEC-009 Task 5: lead/customer 输出投影。
// 按调用者字段权限（FieldReadLevel）输出 L3 字段：READ 明文、MASKED 脱敏、NONE 不返回。
// 参考 SPEC-003 safe-user-projection 的"序列化前裁剪"思路：phoneHash/wechatHash 一律不进入视图。

import type { Customer, Lead } from '@prisma/client';

import type { FieldReadLevel } from '../../domain/authorization/authorization-types';
import type { LeadStatus, PoolStatus } from '../../domain/crm/lead-policy';
import type { CustomerStatus } from '../../domain/events/event-types';
import type { CustomerView, LeadView } from './lead-types';

export interface LeadFieldPermissions {
  phone: FieldReadLevel;
  wechat: FieldReadLevel;
}

/** 电话脱敏：保留前 3 后 4（如 138****1234）；过短一律 ***。 */
export function maskLeadPhone(phone: string): string {
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '***';
}

/** wechat 脱敏：不保留任何片段。 */
export function maskLeadWechat(): string {
  return '***';
}

export function projectLead(lead: Lead, fieldPermissions: LeadFieldPermissions): LeadView {
  return {
    id: lead.id,
    leadNo: lead.leadNo,
    name: lead.name,
    phone: applyReadLevel(lead.phone, fieldPermissions.phone, maskLeadPhone),
    wechat: applyReadLevel(lead.wechat ?? null, fieldPermissions.wechat, maskLeadWechat),
    channelId: lead.channelId,
    sourceType: lead.sourceType,
    sourceDetail: lead.sourceDetail,
    campaignId: lead.campaignId,
    referralCustomerId: lead.referralCustomerId,
    intentionLevel: lead.intentionLevel,
    status: lead.status as LeadStatus,
    poolStatus: lead.poolStatus as PoolStatus,
    branchId: lead.branchId,
    professionalTeamId: lead.professionalTeamId,
    assignedTo: lead.assignedTo,
    assignedAt: lead.assignedAt,
    firstResponseSeconds: lead.firstResponseSeconds,
    isValid: lead.isValid,
    invalidReason: lead.invalidReason,
    tags: lead.tags,
    createdBy: lead.createdBy,
    version: lead.version,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

export function projectCustomer(customer: Customer, fieldPermissions: LeadFieldPermissions): CustomerView {
  return {
    id: customer.id,
    customerNo: customer.customerNo,
    name: customer.name,
    phone: applyReadLevel(customer.phone, fieldPermissions.phone, maskLeadPhone),
    wechat: applyReadLevel(customer.wechat ?? null, fieldPermissions.wechat, maskLeadWechat),
    email: customer.email,
    address: customer.address,
    status: customer.status as CustomerStatus,
    customerType: customer.customerType,
    sourceLeadId: customer.sourceLeadId,
    tags: customer.tags,
    remark: customer.remark,
    createdBy: customer.createdBy,
    version: customer.version,
    createdAt: customer.createdAt,
    // SPEC-031 经营指标缺省零值（customer-service 注入实际聚合）。
    contractCount: 0,
    repurchaseCount: 0,
    referralCount: 0,
    firstContractAt: null,
    latestContractAt: null,
  };
}

function applyReadLevel(
  value: string | null,
  readLevel: FieldReadLevel,
  mask: (value: string) => string,
): string | null {
  if (readLevel === 'NONE' || value === null) return null;
  if (readLevel === 'MASKED') return mask(value);
  return value;
}
