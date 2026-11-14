import { AuthorizationContext } from '../authorization/authorization-service';
import { FieldProjectionService } from '../authorization/field-projection-service';

export const editableBusinessFields = {
  CONTRACTS: ['title', 'amount'],
  CUSTOMERS: ['name', 'phone', 'wechat', 'customerType', 'status', 'email', 'address', 'tags', 'remark'],
  NEGOTIATIONS: ['negotiatorEmployeeId', 'quotedAmount', 'customerConcerns', 'competitorInfo', 'remark'],
  CHANNELS: ['name', 'accountInfo', 'cost', 'status'],
  COSTS: ['amount', 'occurredAt', 'note'],
  PERFORMANCES: ['goal'],
  INVENTORY_ITEMS: ['name', 'category', 'unit', 'specification', 'location', 'minimumStock', 'status'],
} as const;
export type EditableBusinessSource = keyof typeof editableBusinessFields;
export function isEditableBusinessSource(source: string): source is EditableBusinessSource {
  return Object.hasOwn(editableBusinessFields, source);
}
export function editableBusinessKey(source: string, key: string, actor: AuthorizationContext) {
  if (
    !isEditableBusinessSource(source) ||
    !(editableBusinessFields[source] as readonly string[]).includes(key)
  )
    return false;
  if (source === 'CUSTOMERS' && ['phone', 'wechat'].includes(key)) {
    const projection = new FieldProjectionService();
    return (
      projection.fieldCapability(actor, 'customer', 'customer.' + key, 'customer.read').readLevel ===
        'READ' && projection.canWriteField(actor, 'customer', 'customer.' + key, 'customer.update')
    );
  }
  return true;
}
export function businessGridChoices(source: string, key: string) {
  if(source==='PAYMENTS' && key==='invoiceStatus') return [{id:'NOT_ISSUED',name:'未开票'},{id:'ISSUED',name:'已开票'}];
  const choices =
    source === 'CUSTOMERS' && key === 'customerType'
      ? [
          ['INDIVIDUAL', '个人'],
          ['ENTERPRISE', '企业'],
        ]
      : source === 'CUSTOMERS' && key === 'status'
        ? [
            ['POTENTIAL', '潜在客户'],
            ['INTENT', '意向客户'],
            ['SIGNED', '已签约'],
            ['INACTIVE', '不活跃'],
          ]
        : ['CHANNELS', 'INVENTORY_ITEMS'].includes(source) && key === 'status'
          ? [
              ['ENABLED', '启用'],
              ['DISABLED', '停用'],
            ]
          : undefined;
  return choices?.map(([id, name]) => ({ id, name }));
}
