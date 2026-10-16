import { AuthorizationContext } from '../authorization/authorization-service';
import { FieldProjectionService } from '../authorization/field-projection-service';

export const crmWorksheetFields = {
  LEADS: ['name', 'phone', 'wechat', 'intentionLevel'],
  FOLLOWS: ['type', 'content', 'nextPlan', 'nextTime'],
} as const;
export function editableCrmKey(source: string, key: string, actor: AuthorizationContext) {
  if (
    !Object.hasOwn(crmWorksheetFields, source) ||
    !(crmWorksheetFields[source as keyof typeof crmWorksheetFields] as readonly string[]).includes(key)
  )
    return false;
  if (source === 'LEADS' && ['phone', 'wechat'].includes(key)) {
    const projection = new FieldProjectionService();
    return (
      projection.fieldCapability(actor, 'lead', 'lead.' + key, 'lead.read').readLevel === 'READ' &&
      projection.canWriteField(actor, 'lead', 'lead.' + key, 'lead.update')
    );
  }
  return true;
}
export const followTypeChoices = [
  { id: 'PHONE', name: '电话' },
  { id: 'WECHAT', name: '微信' },
  { id: 'VISIT', name: '到访' },
  { id: 'ONLINE', name: '线上' },
  { id: 'OTHER', name: '其他' },
];
