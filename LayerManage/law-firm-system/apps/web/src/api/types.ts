// SPEC-009 Task 11: CRM（线索/邀约/客户）API 类型，逐字镜像后端 Task 10 冻结视图。
// 传输层日期均为 ISO 字符串；L3 字段（phone/wechat）由服务端按字段权限预脱敏，
// 前端原样渲染，绝不尝试还原明文。

export const LEAD_STATUSES = [
  'NEW', 'ASSIGNED', 'CONTACTED', 'SCREENED', 'INVITED', 'VISITED', 'CONVERTED', 'LOST', 'NURTURE',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const POOL_STATUSES = ['PUBLIC', 'PRIVATE', 'RECYCLED'] as const;
export type PoolStatus = (typeof POOL_STATUSES)[number];

export const LEAD_SOURCE_TYPES = ['MANUAL', 'CAMPAIGN', 'REFERRAL', 'NATURAL', 'OFFLINE'] as const;
export type LeadSourceType = (typeof LEAD_SOURCE_TYPES)[number];

export const LEAD_FOLLOW_TYPES = ['PHONE', 'WECHAT', 'VISIT', 'ONLINE', 'OTHER', 'SMS'] as const;
export type LeadFollowType = (typeof LEAD_FOLLOW_TYPES)[number];

export const APPOINTMENT_CHANNELS = ['ONSITE', 'ONLINE'] as const;
export type AppointmentChannel = (typeof APPOINTMENT_CHANNELS)[number];

export const APPOINTMENT_STATUSES = [
  'PENDING', 'CONFIRMED', 'VISITED', 'NOSHOW', 'CANCELLED', 'RESCHEDULED',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const CUSTOMER_STATUSES = ['POTENTIAL', 'INTENT', 'SIGNED', 'INACTIVE'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'ENTERPRISE'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/** Lead 输出视图：镜像 apps/server app/application/crm/lead-types.ts LeadView。 */
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
  assignedAt: string | null;
  firstResponseSeconds: number | null;
  isValid: boolean;
  invalidReason: string | null;
  tags: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 lead-follow-service.ts LeadFollowView。 */
export interface LeadFollowView {
  id: string;
  leadId: string;
  type: string;
  content: string;
  nextPlan: string | null;
  nextTime: string | null;
  createdBy: string;
  createdAt: string;
}

/** 镜像 appointment-service.ts AppointmentView。 */
export interface AppointmentView {
  id: string;
  appointmentNo: string;
  leadId: string;
  scheduledAt: string;
  channel: string;
  negotiatorEmployeeId: string | null;
  status: AppointmentStatus;
  rescheduledFromId: string | null;
  remark: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 lead-types.ts CustomerView。 */
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
  createdAt: string;
  /** SPEC-031 经营指标：合同数 / 复购数（= max(0, 合同数-1)）/ 转介绍数（引荐线索数）/ 首单/最近单时间。 */
  contractCount: number;
  repurchaseCount: number;
  referralCount: number;
  firstContractAt: string | null;
  latestContractAt: string | null;
}

/** 镜像 customer-projection.ts ContactView。 */
export interface ContactView {
  id: string;
  customerId: string;
  name: string;
  phone: string | null;
  wechat: string | null;
  relation: string | null;
  isPrimary: boolean;
  createdBy: string;
  createdAt: string;
}

/** 镜像 lead-types.ts PagedResult（注意：非原型 PaginatedData 的嵌套 pagination 形态）。 */
export interface PagedResult<T> {
  list: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DuplicateSignal {
  leadId: string;
  type: 'PHONE' | 'WECHAT' | 'NAME';
}

export interface CreateLeadResult {
  lead: LeadView;
  duplicates: DuplicateSignal[];
}

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

export interface LeadListQuery {
  page?: number;
  pageSize?: number;
  status?: LeadStatus;
  poolStatus?: PoolStatus;
  channelId?: string;
  assignedTo?: string;
  keyword?: string;
}

/** PATCH /leads/:id 仅承载状态流转（后端无字段更新方法，设计如此）。 */
export interface TransitionLeadInput {
  targetStatus: LeadStatus;
  reason: string;
}

export interface AssignLeadInput {
  toEmployeeId: string;
  reason?: string;
}

export interface RecordFollowInput {
  type: LeadFollowType;
  content: string;
  nextPlan?: string;
  nextTime?: string;
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

export interface ConvertLeadInput {
  customer: ConvertCustomerInput;
  contact: ConvertContactInput;
}

export interface CreateAppointmentInput {
  leadId: string;
  scheduledAt: string;
  channel: AppointmentChannel;
  negotiatorEmployeeId?: string;
  remark?: string;
}

export interface AppointmentRangeQuery {
  from: string;
  to: string;
  page?: number;
  pageSize?: number;
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  wechat?: string;
  email?: string;
  address?: string;
  customerType?: CustomerType;
  status?: CustomerStatus;
  tags?: string;
  remark?: string;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput> & { version?: number };

/** SPEC-039：客户域转介绍登记入参（sourceType/referralCustomerId 由服务端强制绑定）。 */
export interface CreateReferralLeadInput {
  name: string;
  phone: string;
  wechat?: string;
  intentionLevel?: number;
  tags?: string;
}

export interface CustomerListQuery {
  page?: number;
  pageSize?: number;
  status?: CustomerStatus;
  customerType?: CustomerType;
  keyword?: string;
}

export interface ContactInput {
  name?: string;
  phone?: string;
  wechat?: string;
  relation?: string;
  isPrimary?: boolean;
}
