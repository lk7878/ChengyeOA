/** 工作台领域模型类型定义。与 reports/鉴定助手架构方案.md 中的案件空间、
 * 人员角色、案件结构等约定保持一致。后续接入后端时，将 mock 数据替换为
 * 真实接口返回的同形结构即可。 */

export type Role =
  | 'platform_admin' // 平台维护者
  | 'public_admin' // 公共库管理员
  | 'case_owner' // 案件负责人
  | 'appraiser' // 鉴定人员
  | 'reviewer' // 复核人员

export function hasRole(user: { roles?: Role[] } | null | undefined, ...roles: Role[]): boolean {
  return !!user?.roles?.some((r) => roles.includes(r))
}

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: '平台维护者',
  public_admin: '公共库管理员',
  case_owner: '案件负责人',
  appraiser: '鉴定人员',
  reviewer: '复核人员',
}

export type AccountStatus = 'active' | 'disabled' | 'pending'

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: '正常',
  disabled: '已停用',
  pending: '待激活',
}

export interface Account {
  isSystemSuperAdmin?: boolean
  id: string
  username: string
  displayName: string
  email: string
  roles: Role[]
  status: AccountStatus
  createdAt: string
  lastActiveAt: string | null
}

export type CaseStage =
  | 'intake' // 待鉴定
  | 'processing' // 鉴定中
  | 'review' // 复核中
  | 'closed' // 已结案

export const CASE_STAGE_LABELS: Record<CaseStage, string> = {
  intake: '待鉴定',
  processing: '鉴定中',
  review: '复核中',
  closed: '已结案',
}

const STAGE_ALIASES: Record<string, CaseStage> = {
  drafting: 'processing',
  approved: 'closed',
}

/** 把旧状态（报告草拟 / 已出报告等）收成当前四档。 */
export function normalizeCaseStage(stage: string | undefined | null): CaseStage {
  const mapped = STAGE_ALIASES[stage ?? ''] ?? stage
  return mapped && mapped in CASE_STAGE_LABELS ? (mapped as CaseStage) : 'intake'
}

export type CasePriority = 'low' | 'normal' | 'high' | 'urgent'

export const CASE_PRIORITY_LABELS: Record<CasePriority, string> = {
  low: '低',
  normal: '常规',
  high: '高',
  urgent: '紧急',
}

export interface CaseMember {
  accountId: string
  role: Role
  joinedAt: string
}

export type CaseKind = 'general' | 'disability' | 'injury' | 'malpractice' | 'traffic'

export const CASE_KIND_LABELS: Record<CaseKind, string> = {
  general: '通用法律',
  disability: '伤残鉴定',
  injury: '伤情鉴定',
  malpractice: '医疗损害司法鉴定',
  traffic: '交通事故鉴定',
}

export const CASE_KIND_HINTS: Record<CaseKind, string> = {
  general: '检索、分析、起草与复核',
  disability: '人体损伤致残程度鉴定，管理伤残案件材料与意见书',
  injury: '支持问答与检索，专项文书待验收',
  malpractice: '医疗损害过错、原因力与损害后果鉴定',
  traffic: '车速、痕迹、重建、车辆、信号灯与交通设施鉴定',
}

export function normalizeCaseKind(kind: string | undefined | null): CaseKind {
  return kind && kind in CASE_KIND_LABELS ? (kind as CaseKind) : 'general'
}

export function kindToView(kind: CaseKind): ViewId {
  return `cases_${kind}`
}

export function viewToKind(view: ViewId): CaseKind | null {
  if (view === 'cases_general') return 'general'
  if (view === 'cases_disability') return 'disability'
  if (view === 'cases_injury') return 'injury'
  if (view === 'cases_malpractice') return 'malpractice'
  if (view === 'cases_traffic') return 'traffic'
  return null
}

export interface CaseRecord {
  id: string // CASE-<内部案号>
  title: string
  kind: CaseKind
  appellant: string // 委托方/申请人
  respondent: string // 被申请人/医疗机构
  category: string // 案由/专科
  stage: CaseStage
  priority: CasePriority
  ownerId: string // 案件负责人 accountId
  members: CaseMember[]
  materialCount: number
  createdAt: string
  updatedAt: string
  dueAt: string | null
  description: string
}

export interface SharingGroup {
  id: string
  name: string
  memberIds: string[]
  createdAt: string
  updatedAt: string
}

export type ViewId =
  | 'cases_general'
  | 'specialized'
  | 'settings'
  | 'dashboard'
  | 'cases_disability'
  | 'cases_injury'
  | 'cases_malpractice'
  | 'cases_traffic'
  | 'knowledge'
  | 'accounts'
  | 'sharing'

/** 跳转目标：AI 助手与知识库管理。地址在 src/config/links.ts 集中配置，
 * 便于按部署环境替换。 */
export interface ExternalLink {
  id: 'ai_assistant' | 'knowledge_base'
  label: string
  href: string
  description: string
}
