// SPEC-009 Task 8: customer/contact 输出投影（决策 14/15）。
// 完全镜像 lead-projection 的脱敏语义：phone/wechat 按调用者字段能力（customer.read 锚定
// customer.phone / customer.wechat 两条 L3 定义）输出 READ 明文 / MASKED 脱敏 / NONE 不返回。
// projectCustomer 直接委托 lead-projection 的既有实现（Task 5 起即服务 convert 路径），
// 保持单一事实源；projectContact 复用同一 applyReadLevel 规则与掩码函数。
// phoneHash/wechatHash 一律不进入视图。

import type { Contact, Customer } from '@prisma/client';

import type { FieldReadLevel } from '../../domain/authorization/authorization-types';
import type { CustomerMetrics, CustomerView } from './lead-types';
import {
  LeadFieldPermissions,
  maskLeadPhone,
  maskLeadWechat,
  projectCustomer as projectCustomerBase,
} from './lead-projection';

/** customer 域字段能力形状与 lead 相同（phone/wechat 两条 L3）。 */
export type CustomerFieldPermissions = LeadFieldPermissions;

/** SPEC-031 缺省经营指标（无合同/无转介绍）。 */
const DEFAULT_CUSTOMER_METRICS: CustomerMetrics = {
  contractCount: 0,
  repurchaseCount: 0,
  referralCount: 0,
  firstContractAt: null,
  latestContractAt: null,
};

/** Customer 视图投影：委托 lead-projection 既有实现（行为完全一致）+ SPEC-031 经营指标（缺省零值/缺省可传入）。 */
export function projectCustomer(
  customer: Customer,
  fieldPermissions: CustomerFieldPermissions,
  metrics: CustomerMetrics = DEFAULT_CUSTOMER_METRICS,
): CustomerView {
  return { ...projectCustomerBase(customer, fieldPermissions), ...metrics };
}

/** Contact 输出视图：phone/wechat 按 customer.read 字段能力脱敏；不含 phoneHash。 */
export interface ContactView {
  id: string;
  customerId: string;
  name: string;
  phone: string | null;
  wechat: string | null;
  relation: string | null;
  isPrimary: boolean;
  createdBy: string;
  createdAt: Date;
}

export function projectContact(contact: Contact, fieldPermissions: CustomerFieldPermissions): ContactView {
  return {
    id: contact.id,
    customerId: contact.customerId,
    name: contact.name,
    phone: applyReadLevel(contact.phone, fieldPermissions.phone, maskLeadPhone),
    wechat: applyReadLevel(contact.wechat ?? null, fieldPermissions.wechat, maskLeadWechat),
    relation: contact.relation,
    isPrimary: contact.isPrimary,
    createdBy: contact.createdBy,
    createdAt: contact.createdAt,
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
