// Reproducible, idempotent source + shipped-bundle patch for the locked upstream.
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
const root=process.argv[2]
if(!root)throw Error('Pass upstream Harness root')
for(const file of ['packages/client/ui-chat/src/client/locale.ts','packages/client/ui-chat/lib/client.js']){
 const p=path.join(root,file),s=await readFile(p,'utf8');await writeFile(p,s.replaceAll('深度求索中','正在分析'))
}
for(const file of ['packages/client/ui-schedule/src/client/index.ts','packages/client/ui-schedule/lib/client.js']){
 const p=path.join(root,file),s=await readFile(p,'utf8')
 if(s.includes('OA schedule gate'))continue
 const re=file.endsWith('.ts')?/export function apply\(ctx: ClientContext\): void \{/:/function apply\(ctx\)\s*\{/
 if(!re.test(s))throw Error('Upstream schedule apply changed: '+file)
 const global=file.endsWith('.ts')?'(globalThis as any)':'globalThis'
 await writeFile(p,s.replace(re,match=>match+'\n  // OA schedule gate: no subscriptions or header actions for ordinary accounts.\n  if (globalThis.location?.pathname.startsWith("/harness/") && !'+global+'.__oaHarness?.isSuperAdmin) return;'))
}
