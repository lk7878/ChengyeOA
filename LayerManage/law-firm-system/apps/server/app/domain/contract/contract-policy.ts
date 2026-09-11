// SPEC-010 Task 3: contract-policy 领域纯函数与常量。
// 纯领域层：不依赖 Prisma、不依赖 Egg、不连数据库。
// 供 service 层（Task 6-9）调用的合同状态机判定：设计 §6.1 状态机与类型驱动差异。
// 判定次序（协调者钉死）：政策门禁（approve 仅 requiresApproval 类型、effect 仅 generatesReceivable 类型）
// 先于流转表判定；TERMINATED/VOID 为终态，任何动作返回 null。

/** 设计 §6.1：合同类型词汇表。 */
export const CONTRACT_TYPES = ['FIRST_SIGN', 'FORMAL', 'SUPPLEMENT', 'RISK_NOTICE'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/** 设计 §6.1：合同状态词汇表。 */
export const CONTRACT_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'PENDING_SIGN',
  'SIGNED',
  'EFFECTIVE',
  'TERMINATED',
  'VOID',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** 合同生命周期动作（7 个，协调者钉死）。 */
export const CONTRACT_ACTIONS = [
  'submit',
  'approve',
  'reject',
  'sign',
  'effect',
  'terminate',
  'void',
] as const;
export type ContractAction = (typeof CONTRACT_ACTIONS)[number];

/** 合同编号类型码前缀。 */
export const CONTRACT_TYPE_CODES: Readonly<Record<ContractType, string>> = {
  FIRST_SIGN: 'FS',
  FORMAL: 'WT',
  SUPPLEMENT: 'SA',
  RISK_NOTICE: 'RN',
};

/** 类型驱动差异：审批要求 / 是否产生应收 / 签署即终态。 */
export interface ContractTypePolicy {
  readonly requiresApproval: boolean;
  readonly generatesReceivable: boolean;
  readonly terminalAtSigned: boolean;
}

export const CONTRACT_TYPE_POLICY: Readonly<Record<ContractType, ContractTypePolicy>> = {
  FIRST_SIGN: { requiresApproval: true, generatesReceivable: true, terminalAtSigned: false },
  FORMAL: { requiresApproval: true, generatesReceivable: true, terminalAtSigned: false },
  SUPPLEMENT: { requiresApproval: true, generatesReceivable: true, terminalAtSigned: false },
  RISK_NOTICE: { requiresApproval: false, generatesReceivable: false, terminalAtSigned: true },
};

const TERMINAL_STATUSES: ReadonlySet<ContractStatus> = new Set<ContractStatus>([
  'TERMINATED',
  'VOID',
]);

const VOIDABLE_STATUSES: ReadonlySet<ContractStatus> = new Set<ContractStatus>([
  'DRAFT',
  'PENDING_APPROVAL',
  'PENDING_SIGN',
]);

/**
 * 设计 §6.1 合同状态机：返回 action 作用后的目标状态；非法流转返回 null。
 *
 * 流转表：
 *   submit:    DRAFT → requiresApproval ? PENDING_APPROVAL : PENDING_SIGN
 *   approve:   PENDING_APPROVAL → PENDING_SIGN（仅 requiresApproval 类型）
 *   reject:    PENDING_APPROVAL → DRAFT
 *   sign:      PENDING_SIGN → SIGNED
 *   effect:    SIGNED → EFFECTIVE（仅 generatesReceivable 类型；RISK_NOTICE 无 effect）
 *   terminate: EFFECTIVE → TERMINATED
 *   void:      DRAFT|PENDING_APPROVAL|PENDING_SIGN → VOID
 *
 * RISK_NOTICE 因 terminalAtSigned=true 且无 effect 边，SIGNED 即事实终态。
 */
export function canTransitionContract(
  type: ContractType,
  from: ContractStatus,
  action: ContractAction,
): ContractStatus | null {
  // 终态防线：任何动作一律 null。
  if (TERMINAL_STATUSES.has(from)) return null;

  const policy = CONTRACT_TYPE_POLICY[type];

  // 政策门禁先于流转表。
  if (action === 'approve' && !policy.requiresApproval) return null;
  if (action === 'effect' && !policy.generatesReceivable) return null;

  switch (action) {
    case 'submit':
      return from === 'DRAFT' ? (policy.requiresApproval ? 'PENDING_APPROVAL' : 'PENDING_SIGN') : null;
    case 'approve':
      return from === 'PENDING_APPROVAL' ? 'PENDING_SIGN' : null;
    case 'reject':
      return from === 'PENDING_APPROVAL' ? 'DRAFT' : null;
    case 'sign':
      return from === 'PENDING_SIGN' ? 'SIGNED' : null;
    case 'effect':
      return from === 'SIGNED' ? 'EFFECTIVE' : null;
    case 'terminate':
      return from === 'EFFECTIVE' ? 'TERMINATED' : null;
    case 'void':
      return VOIDABLE_STATUSES.has(from) ? 'VOID' : null;
    default:
      return null;
  }
}
