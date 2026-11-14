// SPEC-009 Task 3: lead-policy 领域纯函数与常量。
// 纯领域层：不依赖 Prisma、不依赖 Egg、不连数据库。
// 供 service 层（Task 5 lead-service / Task 6 assignment-service）调用的状态机 / 规范化 / 检索 hash / 去重匹配。

import { createHash } from 'node:crypto';

import { CrmError, LEAD_PHONE_INVALID } from './lead-errors';

/** 设计 §5.1：线索状态机取值。 */
export const LEAD_STATUS = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'SCREENED',
  'INVITED',
  'VISITED',
  'CONVERTED',
  'LOST',
  'NURTURE',
] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

/** 设计 §5.1：公海/私海归属，与 status 正交。 */
export const POOL_STATUS = ['PUBLIC', 'PRIVATE', 'RECYCLED'] as const;
export type PoolStatus = (typeof POOL_STATUS)[number];

/** schema Appointment.status：邀约状态取值。 */
export const APPOINTMENT_STATUS = [
  'PENDING',
  'CONFIRMED',
  'VISITED',
  'NOSHOW',
  'CANCELLED',
  'RESCHEDULED',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[number];

/** spec §5.2：LeadPoolRecord.action 公海/私海流转动作。 */
export const LEAD_POOL_ACTIONS = ['CLAIM', 'ASSIGN', 'REASSIGN', 'RECYCLE'] as const;
export type LeadPoolAction = (typeof LEAD_POOL_ACTIONS)[number];

/**
 * 设计 §6.1 NURTURE→reactivate 流转标记。
 * canTransition 表达"状态机是否允许该箭头"（spec §6.1 标了 reactivate 箭头，故 NURTURE→CONTACTED 返回 true）。
 * service 层（Task 5）在调用 canTransition 前先检查此开关：false 则拒绝 nurture/reactivate 动作。
 * policy 表达"状态机允许"与"本 SPEC 是否启用"分离。
 */
export const REACTIVATE_ENABLED = false;

// 合法流转表：from → 允许的 to 集合。基于设计 §6.1 状态机。
//   NEW ──assign──▶ ASSIGNED ──contact──▶ CONTACTED ──screen──▶ SCREENED
//   SCREENED ──invite──▶ INVITED ──visit──▶ VISITED ──convert──▶ CONVERTED
//   任意活状态 ──lose──▶ LOST ──nurture──▶ NURTURE ──reactivate──▶ CONTACTED
const FORWARD_CHAIN: ReadonlyArray<readonly [LeadStatus, LeadStatus]> = [
  ['NEW', 'ASSIGNED'],
  ['ASSIGNED', 'CONTACTED'],
  ['CONTACTED', 'SCREENED'],
  ['SCREENED', 'INVITED'],
  ['INVITED', 'VISITED'],
  ['VISITED', 'CONVERTED'],
];

const ACTIVE_STATES: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'SCREENED',
  'INVITED',
  'VISITED',
]);

function buildTransitionTable(): Map<LeadStatus, ReadonlySet<LeadStatus>> {
  const table = new Map<LeadStatus, Set<LeadStatus>>();
  const add = (from: LeadStatus, to: LeadStatus): void => {
    let targets = table.get(from);
    if (!targets) {
      targets = new Set<LeadStatus>();
      table.set(from, targets);
    }
    targets.add(to);
  };

  // 主链前向流转。
  for (const [from, to] of FORWARD_CHAIN) add(from, to);

  // 任意活状态 → LOST。
  for (const active of ACTIVE_STATES) add(active, 'LOST');

  // LOST → NURTURE（占位合法流转）。
  add('LOST', 'NURTURE');

  // NURTURE → CONTACTED（spec §6.1 标了 reactivate 箭头；本 SPEC 是否启用由 REACTIVATE_ENABLED 决定）。
  add('NURTURE', 'CONTACTED');

  return table as Map<LeadStatus, ReadonlySet<LeadStatus>>;
}

const TRANSITIONS: ReadonlyMap<LeadStatus, ReadonlySet<LeadStatus>> = buildTransitionTable();

/** 状态机是否允许 from→to 流转。同态流转一律返回 false。 */
export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS.get(from)?.has(to) ?? false;
}

// ===== 电话/wechat 规范化与检索 hash =====

// 允许并剥离的格式字符：空白 / 横线 / 括号 / 前缀加号。其余非数字字符（字母等）一律拒绝。
const ALLOWED_PHONE_CHARS = /^[0-9+\-() ]+$/;
const CN_PREFIX = /^(?:0086|86|\+86)(\d{7,})$/;
const DIGITS_ONLY = /^\d+$/;
const MIN_PHONE_LEN = 7;

/**
 * 规范化电话：仅允许数字与空白/横线/括号/前缀 `+`；非法字符（字母等）抛错。
 * 剥离 +86/86/0086 国际前缀；不强制 11 位（兼容座机/国际号），
 * 但去前缀后必须 >=7 位纯数字，否则视为非法格式抛错。
 */
export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new CrmError(LEAD_PHONE_INVALID, 400, 'phone must be a non-empty string');
  }
  if (!ALLOWED_PHONE_CHARS.test(raw)) {
    throw new CrmError(LEAD_PHONE_INVALID, 400, 'phone contains illegal characters');
  }
  // 去除所有非数字，仅保留可选的起首 +。
  const plus = raw.trim().startsWith('+') ? '+' : '';
  const digits = plus + raw.replace(/[^\d]/g, '');
  if (digits.length === 0) {
    throw new CrmError(LEAD_PHONE_INVALID, 400, 'phone must contain digits');
  }
  // 处理 +86 / 86 / 0086 国际前缀。仅当后接至少 MIN_PHONE_LEN 位时才认定为前缀。
  const stripped = digits.startsWith('+') ? digits.slice(1) : digits;
  const cnMatch = stripped.match(CN_PREFIX);
  const normalized = cnMatch ? cnMatch[1] : stripped;
  if (!DIGITS_ONLY.test(normalized) || normalized.length < MIN_PHONE_LEN) {
    throw new CrmError(LEAD_PHONE_INVALID, 400, `phone normalized to fewer than ${MIN_PHONE_LEN} digits`);
  }
  return normalized;
}

/**
 * 电话检索 hash：无盐 sha256，64 位小写十六进制。仅用于检索/去重，非密码 hash。
 * 入参应为 normalizePhone 的产物；函数内部不二次规范化以保持纯函数。
 */
export function hashPhone(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * wechat 检索 hash：trim 后为空返回 null；否则无盐 sha256。
 * 与 hashPhone 同为检索 hash，非密码用途。
 */
export function hashWechat(raw?: string | null): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return createHash('sha256').update(trimmed, 'utf8').digest('hex');
}

// ===== 去重信号匹配 =====

export type DuplicateSignalType = 'PHONE' | 'WECHAT' | 'NAME';

export interface DuplicateSignal {
  leadId: string;
  type: DuplicateSignalType;
}

export interface DuplicateCandidate {
  id: string;
  name: string;
  phoneHash: string;
  wechatHash?: string | null;
}

export interface DuplicateProbeInput {
  name?: string | null;
  phoneHash?: string | null;
  wechatHash?: string | null;
}

/**
 * 去重信号匹配（纯函数）：service 层负责查库返回候选，本函数仅做命中判定。
 * 匹配规则（设计 §9：去重查询走 phoneHash/wechatHash 精确匹配，无全表正则）：
 *   - phoneHash 完全相等 → 一条 PHONE 信号
 *   - wechatHash 完全相等 → 一条 WECHAT 信号
 *   - name 完全相等（区分大小写精确匹配，不做模糊） → 一条 NAME 信号
 * 一个 candidate 多个命中则多条信号；不返回明文。
 */
export function findDuplicateSignals(
  input: DuplicateProbeInput,
  candidates: ReadonlyArray<DuplicateCandidate>,
): DuplicateSignal[] {
  const out: DuplicateSignal[] = [];
  const wantName = typeof input.name === 'string' && input.name.length > 0 ? input.name : null;
  const wantPhone = typeof input.phoneHash === 'string' && input.phoneHash.length > 0 ? input.phoneHash : null;
  const wantWechat = typeof input.wechatHash === 'string' && input.wechatHash.length > 0 ? input.wechatHash : null;

  if (!wantName && !wantPhone && !wantWechat) return out;

  for (const candidate of candidates) {
    if (wantPhone && candidate.phoneHash === wantPhone) {
      out.push({ leadId: candidate.id, type: 'PHONE' });
    }
    if (wantWechat && typeof candidate.wechatHash === 'string' && candidate.wechatHash === wantWechat) {
      out.push({ leadId: candidate.id, type: 'WECHAT' });
    }
    if (wantName !== null && candidate.name === wantName) {
      out.push({ leadId: candidate.id, type: 'NAME' });
    }
  }
  return out;
}
