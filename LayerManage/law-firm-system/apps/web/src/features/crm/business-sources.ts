export const businessSources = {
  QUALITY_ANALYSES:{title:'专项分析工作表',path:'/quality/special-analyses',personal:'我创建的专项分析'},
  QUALITY_REVIEWS:{title:'二级抽检工作表',path:'/quality/reviews',personal:'我创建的检查'},
  QUALITY_ISSUES:{title:'质检问题工作表',path:'/quality/issues',personal:'我创建的问题'},
  SOP_TASKS: { title:'SOP任务工作表', path:'/sop/tasks', personal:'分派给我的任务' },
  CHANNELS: { title: '渠道工作表', path: '/channels', personal: '我登记的渠道' },
  INVENTORY_ITEMS: { title: '物品库存工作表', path: '/inventory/items', personal: '我登记的物品' },
  INVENTORY_MOVEMENTS: { title: '出入库工作表', path: '/inventory/movements', personal: '我登记的出入库' },
  INVENTORY_STOCKTAKES: { title: '盘点工作表', path: '/inventory/stocktakes', personal: '我登记的盘点' },
  PERFORMANCES: { title: '绩效工作表', path: '/performances', personal: '我登记的绩效' },
  PAYMENTS: { title: '收款工作表', path: '/payments', personal: '我登记的收款' },
  INVOICES: { title: '发票工作表', path: '/invoices', personal: '我申请的发票' },
  REFUNDS: { title: '退款减免工作表', path: '/refunds', personal: '我的退款减免' },
  COSTS: { title: '成本工作表', path: '/costs', personal: '我登记的成本' },
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
  CHANNELS: { label: '登记渠道', path: '/channels/new', permission: 'channel.create' },
  INVENTORY_ITEMS: { label: '新增物品', path: '/inventory/items/new', permission: 'inventory.manage' },
  INVENTORY_MOVEMENTS: {
    label: '登记出入库',
    path: '/inventory/movements/new',
    permission: 'inventory.read',
  },
  INVENTORY_STOCKTAKES: {
    label: '新增盘点',
    path: '/inventory/stocktakes/new',
    permission: 'inventory.stocktake',
  },
  PERFORMANCES: { label: '登记绩效', path: '/performances/new', permission: 'performance.create' },
  PAYMENTS: { label: '登记收款', path: '/payments/new', permission: 'payment.create' },
  INVOICES: { label: '申请发票', path: '/invoices/new', permission: 'invoice.create' },
  REFUNDS: { label: '申请退款减免', path: '/refunds/new', permission: 'refund.create' },
  COSTS: { label: '登记成本', path: '/costs/new', permission: 'cost.create' },
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

export const moduleOptions = Object.entries(businessSources).map(([value, source]) => ({ value, label: source.title }));
