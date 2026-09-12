/** Copy a source snapshot without touching its original worktree or copying private runtime data. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const source=realpathSync(resolve(process.argv[2]||''));
if(!process.argv[2])throw new Error('Usage: node import-harness-source.mjs <source checkout>');
const target=join(root,'third_party/deepseek-harness');
if(existsSync(target))throw new Error('Destination already exists; upgrades must preserve and review local patches explicitly.');
const git=args=>{const r=spawnSync('git',args,{cwd:source,maxBuffer:64*1024*1024});if(r.status!==0)throw new Error('Source Git inspection failed');return r.stdout;};
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const status=git(['status','--porcelain=v1','--untracked-files=all','-z']),diff=git(['diff','--binary','HEAD']);
const untracked=new Set(git(['ls-files','--others','--exclude-standard','-z']).toString().split('\0'));
const paths=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean))].sort();
const modes=new Map(git(['ls-files','--stage','-z']).toString().split('\0').filter(Boolean).map(row=>{const [info,path]=row.split('\t');return [path,info.split(' ')[0]];}));
const excluded=[],files=[];
const privatePath=/(^|\/)(node_modules|\.git|\.env[^/]*|\.dsh-home|\.dsh-build|\.runtime|\.cache|\.venv|__pycache__)(\/|$)|\.(db|sqlite|sqlite3|log|tsbuildinfo)$/i;
for(const path of paths){
  if(privatePath.test(path)||path.startsWith('.claude/')){excluded.push({path,reason:'private, generated or machine-specific'});continue;}
  const from=join(source,path);if(!existsSync(from)){excluded.push({path,reason:'deleted in source worktree'});continue;}
  const rel=relative(source,realpathSync(from));if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw new Error('Source file resolves outside checkout: '+path);
  const stat=lstatSync(from);if(!stat.isFile()&&!stat.isSymbolicLink())throw new Error('Unexpected source entry: '+path);
  const bytes=readFileSync(from),to=join(target,path),repositoryMode=modes.get(path)==='100755'?'100755':'100644';mkdirSync(dirname(to),{recursive:true});writeFileSync(to,bytes,{flag:'wx',mode:repositoryMode==='100755'?0o755:0o644});
  const lf=/\.(ts|tsx|js|mjs|md|yml|yaml|json|py|css|html|txt|sh|toml)$/.test(path)?Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n')):bytes;
  files.push({path,sha256:hash(bytes),...(hash(lf)!==hash(bytes)?{repositorySha256:hash(lf)}:{}),repositoryMode,bytes:bytes.length,sourceUntracked:untracked.has(path),...(stat.isSymbolicLink()?{materializedSymlink:true}:{})});
}
const manifest={schemaVersion:1,sourceProject:'deepseek-ai/deepseek-harness',upstream:'https://github.com/deepseek-ai/deepseek-harness.git',sourceHead:git(['rev-parse','HEAD']).toString().trim(),sourceVersion:JSON.parse(readFileSync(join(source,'package.json'),'utf8')).version,createdAt:new Date().toISOString(),sourceStatusSha256:hash(status),sourceDiffSha256:hash(diff),snapshotSha256:hash(Buffer.from(files.map(f=>f.path+' '+f.sha256).join('\n'))),license:'MIT; see included THIRD_PARTY_NOTICES.md and vendor licenses',files,excluded};
if(hash(status)!==hash(git(['status','--porcelain=v1','--untracked-files=all','-z']))||hash(diff)!==hash(git(['diff','--binary','HEAD'])))throw new Error('Source changed during snapshot; review before use.');
writeFileSync(join(root,'third_party/deepseek-harness.source.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),untrackedIncluded:files.filter(f=>f.sourceUntracked).length,excluded:excluded.length,snapshotSha256:manifest.snapshotSha256}));
