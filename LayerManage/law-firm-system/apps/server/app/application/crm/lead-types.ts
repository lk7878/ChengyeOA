// SPEC-009 Task 5: lead-service DTO 与视图类型。
// DuplicateSignal 复用 Task 3 lead-policy 的定义（去重命中判定纯函数的产物），此处仅 re-export。

import type { DuplicateSignal, LeadStatus, PoolStatus } from '../../domain/crm/lead-policy';
import type { CustomerStatus } from '../../domain/events/event-types';

export type { DuplicateSignal } from '../../domain/crm/lead-policy';

/** schema Lead.sourceType 取值。 */
export const LEAD_SOURCE_TYPES = ['MANUAL', 'CAMPAIGN', 'REFERRAL', 'NATURAL', 'OFFLINE'] as const;
export type LeadSourceType = (typeof LEAD_SOURCE_TYPES)[number];

/** schema Customer.customerType 取值。 */
export const CUSTOMER_TYPES = ['INDIVIDUAL', 'ENTERPRISE'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export interface CreateLeadInput {
  name: string;
  phone: string;
  wechat?: string;
  channelId?: string;
  sourceDetail?: string;
  sourceType?: LeadSourceType;
  campaignId?: string;
  referralCustomerId?: string;
  intentionLevel?: number;
  tags?: string;
  branchId?: string;
  professionalTeamId?: string;
}

// SPEC-039：客户域转介绍登记入参（sourceType/referralCustomerId 由 createReferralLead 强制绑定）。
export interface CreateReferralLeadInput {
  name: string;
  phone: string;
  wechat?: string;
  intentionLevel?: number;
  tags?: string;
}

export interface ConvertCustomerInput {
  name: string;
  phone: string;
  wechat?: string;
  email?: string;
  address?: string;
  customerType?: CustomerType;
  tags?: string;
  remark?: string;
}

export interface ConvertContactInput {
  name: string;
  phone: string;
  wechat?: string;
  relation?: string;
  isPrimary?: boolean;
}

/** Lead 输出视图：phone/wechat 已由 lead-projection 按字段权限脱敏；不含 phoneHash/wechatHash。 */
export interface LeadView {
  id: string;
  leadNo: string;
  name: string;
  phone: string | null;
  wechat: string | null;
  channelId: string | null;
  sourceType: string;
  sourceDetail: string | null;
  campaignId: string | null;
  referralCustomerId: string | null;
  intentionLevel: number;
  status: LeadStatus;
  poolStatus: PoolStatus;
  branchId: string | null;
  professionalTeamId: string | null;
  assignedTo: string | null;
  assignedAt: Date | null;
  firstResponseSeconds: number | null;
  isValid: boolean;
  invalidReason: string | null;
  tags: string | null;
  createdBy: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Customer 输出视图：phone/wechat 同样按 customer 资源字段权限脱敏。 */
export interface CustomerView {
  id: string;
  customerNo: string;
  name: string;
  phone: string | null;
  wechat: string | null;
  email: string | null;
  address: string | null;
  status: CustomerStatus;
  customerType: string;
  sourceLeadId: string | null;
  tags: string | null;
  remark: string | null;
  createdBy: string;
  version: number;
  createdAt: Date;
  /** SPEC-031 经营指标：合同数（deletedAt null）/ 复购数（= max(0, contractCount-1)）/ 转介绍数（引荐线索数）/ 首单/最近单时间。 */
  contractCount: number;
  repurchaseCount: number;
  referralCount: number;
  firstContractAt: Date | null;
  latestContractAt: Date | null;
}

/** SPEC-031 客户经营指标聚合（customer-service 注入视图）。 */
export interface CustomerMetrics {
  contractCount: number;
  repurchaseCount: number;
  referralCount: number;
  firstContractAt: Date | null;
  latestContractAt: Date | null;
}

export interface LeadListQuery {
  page?: number;
  pageSize?: number;
  status?: LeadStatus;
  poolStatus?: PoolStatus;
  channelId?: string;
  assignedTo?: string;
  keyword?: string;
}

export interface PagedResult<T> {
  list: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateLeadResult {
  lead: LeadView;
  duplicates: DuplicateSignal[];
}
