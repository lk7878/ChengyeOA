export const businessSources = {
  CASES: { title: '案件工作表', path: '/cases', personal: '我创建的案件' },
  LEADS: { title: '线索工作表', path: '/leads', personal: '我负责的' },
  FOLLOWS: { title: '跟进工作表', path: '/leads/follows', personal: '我的跟进' },
  CUSTOMERS: { title: '客户工作表', path: '/customers', personal: '我创建的客户' },
  NEGOTIATIONS: { title: '谈案工作表', path: '/negotiations', personal: '我创建的谈案' },
  CONTRACTS: { title: '合同工作表', path: '/contracts', personal: '我创建的合同' },
} as const;
export type BusinessSource = keyof typeof businessSources;
export function isBusinessSource(source: string): source is BusinessSource {
  return Object.prototype.hasOwnProperty.call(businessSources, source);
}

export const domainCreates = {
  CASES: { label: '新建案件', path: '/cases/new', permission: 'case.create' },
  CUSTOMERS: { label: '新建客户', path: '/customers/new', permission: 'customer.create' },
  NEGOTIATIONS: { label: '新建谈案', path: '/negotiations/new', permission: 'negotiation.create' },
  CONTRACTS: { label: '新建合同', path: '/contracts/new', permission: 'contract.create' },
} as const;
export function domainCreate(source: string | undefined) {
  return source && Object.hasOwn(domainCreates, source)
    ? domainCreates[source as keyof typeof domainCreates]
    : undefined;
}
