// 全局类型定义

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedData<T> {
  list: T[];
  pagination: Pagination;
}

// 用户
export interface User {
  id: string;
  username: string;
  status: 'ENABLED' | 'DISABLED';
  employeeId?: string;
  employee?: Employee;
  userRoles?: UserRole[];
  lastLoginAt?: string;
  createdAt: string;
}

export interface UserRole {
  id: string;
  userId: string;
  roleId: string;
  role: Role;
}

// 角色权限
export interface Role {
  id: string;
  name: string;
  code: string;
  type: 'SYSTEM' | 'BUSINESS';
  description?: string;
  status: string;
  permissions?: RolePermission[];
}

export interface Permission {
  id: string;
  code: string;
  name: string;
  parentId?: string;
  type: 'MENU' | 'BUTTON' | 'API';
  path?: string;
  children?: Permission[];
}

export interface RolePermission {
  id: string;
  roleId: string;
  permissionId: string;
  permission: Permission;
}

// 员工
export interface Employee {
  id: string;
  employeeNo: string;
  name: string;
  phone: string;
  email?: string;
  type: string;
  status: 'PROBATION' | 'FORMAL' | 'LEAVED';
  entryDate: string;
  leaveDate?: string;
  orgId: string;
  positionId: string;
  organization?: Organization;
  position?: Position;
  createdAt: string;
}

// 组织架构
export interface Organization {
  id: string;
  name: string;
  type: 'FIRM' | 'BRANCH' | 'DEPARTMENT';
  parentId?: string;
  sort: number;
  status: string;
  children?: Organization[];
}

export interface Position {
  id: string;
  name: string;
  orgId: string;
  level: number;
  responsibilities?: string;
}

// 渠道
export interface Channel {
  id: string;
  name: string;
  type: string;
  accountInfo?: string;
  cost: number;
  status: string;
}

// 线索
export interface Lead {
  id: string;
  name: string;
  phone: string;
  wechat?: string;
  channelId?: string;
  channel?: Channel;
  sourceDetail?: string;
  intentionLevel: number;
  status: string;
  assignedTo?: string;
  assignee?: Employee;
  isValid: boolean;
  invalidReason?: string;
  tags?: string;
  followRecords?: LeadFollow[];
  customer?: Customer;
  createdAt: string;
}

export interface LeadFollow {
  id: string;
  leadId: string;
  type: string;
  content: string;
  nextPlan?: string;
  nextTime?: string;
  createdBy: string;
  createdAt: string;
}

// 客户
export interface Customer {
  id: string;
  name: string;
  phone: string;
  wechat?: string;
  idCard?: string;
  email?: string;
  address?: string;
  status: string;
  leadId?: string;
  tags?: string;
  remark?: string;
  createdAt: string;
}

// 案件（SPEC-033 Task 3：对齐后端 case-types.ts CaseView——fee 字符串 Decimal、teamIds
// 字符串数组、lawyerId 可空。customer/lawyer 保留可选嵌套：CaseView 投影不返回（前端用 ID），
// dashboard alerts urgentCases 为原始 Prisma include 会返回嵌套 customer/lawyer。）
export interface Case {
  createdBy?: string | null;
  branchId?: string | null;
  customerName?: string;
  lawyerName?: string | null;
  files?: CaseFile[];
  intakeData?: import('@/pages/Case/intake-contract').CaseIntake;
  updatedAt?: string;
  version: number;
  id: string;
  caseNo: string;
  title: string;
  customerId: string;
  customer?: Customer;
  contractId: string | null;
  lawyerId: string | null;
  lawyer?: Employee;
  teamIds?: string[] | null;
  caseType: string;
  status: string;
  priority: string;
  fee: string;
  description?: string | null;
  result?: string | null;
  satisfaction?: number | null;
  isReferrable: boolean;
  closedAt?: string | null;
  tasks?: CaseTask[];
  communications?: Communication[];
  createdAt: string;
}

export interface CaseTask {
  id: string;
  caseId: string;
  name: string;
  nodeType: string;
  status: string;
  dueDate?: string | null;
  completedAt?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

// SPEC-042：案件文件/证据（base64 上传落盘，fileName 为元数据）。
export interface CaseFile {
  category?: string | null;
  id: string;
  caseId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: string;
}

export interface CaseFileDownload extends CaseFile {
  base64: string;
}

export interface Communication {
  id: string;
  caseId: string;
  type: string;
  content: string;
  isKey: boolean;
  createdBy: string;
  createdAt: string;
}

// 通知
export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  relatedId?: string;
  relatedType?: string;
  createdAt: string;
}

// 绩效
export interface Performance {
  version: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  id: string;
  employeeId: string;
  employee?: Employee;
  period: string;
  type: string;
  kpiData: string;
  score?: string | null;
  bonus?: string | null;
  remark?: string | null;
  status: string;
  goal?: string | null;
  selfScore?: number | null;
  selfComment?: string | null;
  managerScore?: number | null;
  managerComment?: string | null;
  reviewerId?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// SPEC-044：绩效业务指标（该员工考核周期案件办结数/回款额）；SPEC-045：+autoScore 自动计分。
export interface PerformanceBusinessMetrics {
  closedCases: number | null;
  confirmedRevenue: string | null;
  autoScore: number | null;
}

// 仪表盘
export interface DashboardMetrics {
  overview: {
    leadCount: number;
    customerCount: number;
    contractCount: number;
    caseCount: number;
    totalRevenue: number;
    employeeCount: number;
  };
  monthly: {
    newLeads: number;
    newContracts: number;
    monthRevenue: number;
  };
}

export interface DashboardAlerts {
  overdueTasks: number;
  // 服务端返回应收计划行（dashboard.alerts，take 10）；本页仅消费 .length——
  // 原型 Payment interface 已随 SPEC-010 终审修复轮 F-4 删除（死类型，零消费者）。
  overduePayments: unknown[];
  unassignedLeads: number;
  urgentCases: Case[];
}
export * from '@/features/master-data/types';
