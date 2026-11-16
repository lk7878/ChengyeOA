import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { CollabField } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { fail, object } from './collaboration-policy';
import { hrPrivate } from './hr-worksheets';

export const canReadHrPrivate = (actor:AuthorizationContext) => actor.isSystemSuperAdmin || actor.permissionCodes.includes('hr.worksheet.sensitive');
export const canManageHr = (actor:AuthorizationContext) => actor.isSystemSuperAdmin || actor.permissionCodes.includes('hr.worksheet.manage');
// Domain separation: never use the MFA encryption key directly for personnel records.
// v1 derives from MFA_ENCRYPTION_KEY_V1, which must be retained when rotating keys.
function key() {
  const root=Buffer.from(process.env.MFA_ENCRYPTION_KEY_V1??'','base64');
  if(root.length!==32) throw new Error('HR_ENCRYPTION_KEY_INVALID');
  return createHmac('sha256',root).update('chengye-oa:hr-fields:v1').digest();
}
function crypt(field:CollabField,value:unknown,encrypt:boolean):unknown {
  if(value==null||value===''||field.type==='FILE'||!hrPrivate(field)) return value;
  const aad=Buffer.from(`${field.tableId}:${field.id}`);
  if(encrypt) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
    cipher.setAAD(aad);
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return 'hr:v1:'+Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
  }
  if(typeof value!=='string'||!value.startsWith('hr:v1:')) fail('HR_ENCRYPTED_VALUE_REQUIRED');
  const data=Buffer.from(value.slice(6),'base64');
  const cipher=createDecipheriv('aes-256-gcm',key(),data.subarray(0,12));
  cipher.setAAD(aad);cipher.setAuthTag(data.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8'));
}
export function hrValues(fields:CollabField[],raw:unknown,encrypt:boolean) {
  const values={...object(raw)};
  for(const field of fields) if(Object.hasOwn(values,field.id)) values[field.id]=crypt(field,values[field.id],encrypt);
  return values;
}
export function presentHrValue(actor:AuthorizationContext,field:CollabField,value:unknown) {
  if(!hrPrivate(field)) return value;
  if(field.type==='FILE') return canReadHrPrivate(actor)?value:[];
  const plain=crypt(field,value,false);
  return plain;
}
export function hrAge(fields:CollabField[],values:Record<string,unknown>) {
  const id=fields.find(f=>object(f.options).hrIdentity);
  if(!id) return null;
  const value=String(crypt(id,values[id.id],false)??'');
  if(!/^\d{17}[\dXx]$/.test(value)) return null;
  const date=value.slice(6,10)+'-'+value.slice(10,12)+'-'+value.slice(12,14),parsed=new Date(date);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||parsed.getTime()>Date.now()) return null;
  return Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric'}).format(new Date()))-parsed.getUTCFullYear();
}
