export const inventoryWorksheetRoutes: Record<string, { kind: string; title: string }> = {
  'customized-records': { kind: 'INVENTORY_REGISTER', title: '行政事务' },
  'office-records': { kind: 'OFFICE_REGISTER', title: '办公用品领用明细' },
  inbound: { kind: 'OFFICE_INBOUND', title: '入库明细' },
  outbound: { kind: 'OFFICE_OUTBOUND', title: '出库明细' },
};
