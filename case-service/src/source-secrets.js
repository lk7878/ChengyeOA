// Keep the deployment bootstrap readable during migration without retaining a
// second plaintext copy of its credentials. The normal rotation path uses the registry.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'

const prefix='oa-sealed-v1:'
export function sourceSecret(value,field,root,seal=false){
 if(!value||(!seal&&!value.startsWith(prefix))||(seal&&value.startsWith(prefix)))return value
 const key=readFileSync(path.join(root,'model-encryption.key'))
 if(seal){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv)
  cipher.setAAD(Buffer.from(field))
  const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()])
  return prefix+[iv,cipher.getAuthTag(),data].map(b=>b.toString('base64')).join('.')
 }
 const [iv,tag,data]=value.slice(prefix.length).split('.').map(s=>Buffer.from(s,'base64'))
 const cipher=createDecipheriv('aes-256-gcm',key,iv)
 cipher.setAAD(Buffer.from(field));cipher.setAuthTag(tag)
 return Buffer.concat([cipher.update(data),cipher.final()]).toString()
}
