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

// 合同
export interface Contract {
  id: string;
  contractNo: string;
  title: string;
  type: string;
  customerId: string;
  customer?: Customer;
  amount: number;
  paidAmount: number;
  status: string;
  signDate?: string;
  startDate?: string;
  endDate?: string;
  paymentTerms?: string;
  terms?: string;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

// 收款
export interface Payment {
  id: string;
  contractId?: string;
  contract?: Contract;
  customerId: string;
  customer?: Customer;
  amount: number;
  receivedAmount: number;
  status: string;
  dueDate?: string;
  receivedDate?: string;
  paymentMethod?: string;
  paymentAccount?: string;
  remark?: string;
}

// 案件
export interface Case {
  id: string;
  caseNo: string;
  title: string;
  customerId: string;
  customer?: Customer;
  contractId?: string;
  contract?: Contract;
  lawyerId: string;
  lawyer?: Employee;
  teamIds?: string;
  caseType: string;
  status: string;
  priority: string;
  fee: number;
  description?: string;
  result?: string;
  satisfaction?: number;
  isReferrable: boolean;
  closedAt?: string;
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
  dueDate?: string;
  completedAt?: string;
  remark?: string;
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

// 审批
export interface Approval {
  id: string;
  type: string;
  title: string;
  applicantId: string;
  content: string;
  status: string;
  approverId?: string;
  approvedAt?: string;
  remark?: string;
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
  id: string;
  employeeId: string;
  employee?: Employee;
  period: string;
  type: string;
  kpiData: string;
  score?: number;
  bonus?: number;
  remark?: string;
  status: string;
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
  overduePayments: Payment[];
  unassignedLeads: number;
  urgentCases: Case[];
}
export * from '@/features/master-data/types';
