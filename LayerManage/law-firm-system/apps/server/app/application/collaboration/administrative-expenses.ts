import { CollabField, CollabTable, Prisma } from '@prisma/client';
import { object } from './collaboration-policy';

export const expenseKind = 'ADMIN_EXPENSES';
export const expenseName = '行政费用支出表';
export function expenseFields() {
  return [
    ['序号', 'AUTONUMBER'], ['采购日期', 'DATETIME'], ['申请人', 'TEXT'],
    ['支付方式', 'SINGLE_SELECT'], ['费用类型', 'SINGLE_SELECT'], ['产品名称', 'TEXT'],
    ['单位', 'TEXT'], ['数量', 'NUMBER'], ['单价', 'CURRENCY'], ['费用金额', 'FORMULA'],
    ['发票是否收到', 'SINGLE_SELECT'], ['备注', 'LONG_TEXT'],
  ].map(([name, type], position) => ({
    name, type, position, required: ['采购日期', '申请人', '产品名称'].includes(name),
    options: {
      inventoryKey: name,
      ...(position === 0 ? { primary: true } : {}),
      ...(name === '采购日期' ? { dateOnly: true } : {}),
      ...(['单价', '费用金额'].includes(name) ? { numberFormat: 'CNY' } : {}),
      ...(name === '费用金额' ? { formula: '[数量] * [单价]', helpText: '数量乘以单价，按人民币保留两位小数；任一项未填写时显示为空，保存后自动重算。' } : {}),
      ...(['支付方式', '费用类型', '发票是否收到'].includes(name) ? {
        choices: (name === '支付方式' ? ['微信', '支付宝', '银行转账', '现金', '企业信用卡', '其他']
          : name === '费用类型' ? ['办公费', '差旅费', '招待费', '水电物业费', '快递费', '其他'] : ['是', '否']).map(name => ({ id: name, name })),
      } : {}),
    } as Prisma.InputJsonObject,
  }));
}

/** Compute from the same row snapshot used by sorting/filtering, never from a client-supplied total. */
export function expenseProjection(table: CollabTable, fields: CollabField[]) {
  const byName = (name: string) => fields.find(f => object(f.options).inventoryKey === name);
  const total = byName('费用金额'), quantity = byName('数量'), price = byName('单价');
  // A hidden operand must not be exposed indirectly through the computed amount.
  const amount = quantity && price
    ? Prisma.sql`round((r.values ->> ${quantity.id})::numeric * (r.values ->> ${price.id})::numeric, 2)::text`
    : Prisma.sql`NULL::text`;
  return Prisma.sql`SELECT r.id, r."tableId", r."createdBy", r."updatedBy", r."ownerId", r.version,
    r.archived, r."createdAt", r."updatedAt", ${total
      ? Prisma.sql`r.values || jsonb_build_object(${total.id}::text, ${amount})`
      : Prisma.sql`r.values`} AS values FROM collab_record r WHERE r."tableId"=${table.id}`;
}
