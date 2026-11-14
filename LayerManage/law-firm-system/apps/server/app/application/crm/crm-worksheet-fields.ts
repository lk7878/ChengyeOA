import { followEditable } from './follow-worksheet-fields';
import { AuthorizationContext } from '../authorization/authorization-service';
import { FieldProjectionService } from '../authorization/field-projection-service';

export const crmWorksheetFields = {
  LEADS: ['name', 'phone', 'wechat', 'intentionLevel'],
  FOLLOWS: followEditable,
} as const;
export function editableCrmKey(source: string, key: string, actor: AuthorizationContext) {
  if (
    !Object.hasOwn(crmWorksheetFields, source) ||
    !(crmWorksheetFields[source as keyof typeof crmWorksheetFields] as readonly string[]).includes(key)
  )
    return false;
  if (['LEADS','FOLLOWS'].includes(source) && ['phone', 'wechat'].includes(key)) {
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
  { id: 'VISIT', name: '面谈' },
  { id: 'ONLINE', name: '线上会议' },
  { id: 'SMS', name: '短信' },
];
