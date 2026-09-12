import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const manifest=JSON.parse(readFileSync(join(root,'third_party/deepseek-harness.source.json'),'utf8'));
const failures=[];
for(const item of manifest.files){try{const hash=createHash('sha256').update(readFileSync(join(root,'third_party/deepseek-harness',item.path))).digest('hex');if(hash!==item.sha256 && hash!==item.repositorySha256)failures.push(item.path);}catch{failures.push(item.path);}}
if(failures.length)throw new Error('Snapshot differs; review and record patches: '+failures.join(', '));
console.log('Verified '+manifest.files.length+' source files against the imported working-tree snapshot.');
