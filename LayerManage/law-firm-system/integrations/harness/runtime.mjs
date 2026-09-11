import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
export function accountPaths(root, oaApiOrigin, userId) {
  if (typeof userId !== 'string' || !userId || userId.length > 200) throw new Error('INVALID_IDENTITY');
  const key = createHash('sha256').update(oaApiOrigin + '\n' + userId).digest('hex');
  const directory = join(resolve(root), 'accounts', key);
  return { key, directory, home: join(directory, 'home'), workspace: join(directory, 'workspace') };
}
export function childEnvironment(home) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/API_?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|DATABASE_URL|APP_KEYS|NODE_OPTIONS|DSH_|OPENAI_|DEEPSEEK_|ANTHROPIC_|AZURE_|MFA_/i.test(key)) delete env[key];
  return { ...env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED', DSH_PERMISSION_MODE: 'workspace-write', PYTHONDONTWRITEBYTECODE: '1', NO_COLOR: '1' };
}
export function redactDiagnostic(value) { return String(value).replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[redacted]').replace(/(Bearer\s+)\S+/gi, '$1[redacted]').slice(-6000); }
export function validateInstallation(root) {
  for (const file of ['apps/cli/lib/bin.js','apps/web/dist/index.html','packages/product/product-knowledge/lib/index.js','packages/product/product-knowledge/lib/client.js']) if (!existsSync(join(root,file))) throw new Error('HARNESS_NOT_BUILT');
  const pkg = JSON.parse(readFileSync(join(root,'apps/cli/package.json'),'utf8'));
  if (pkg.name !== '@deepseek-ai/dsh') throw new Error('HARNESS_INSTALL_INVALID');
  return pkg.version;
}
function alive(pid) { if (!Number.isSafeInteger(pid) || pid < 1) return false; try { process.kill(pid,0); return true; } catch (e) { return e.code === 'EPERM'; } }
function stopChild(child) {
  if (child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  else child.kill('SIGTERM');
}
async function cli(config, paths, args, owner) {
  if(owner.closed)throw new Error('HARNESS_STOPPED');
  return new Promise((resolvePromise,reject) => {
    const child = spawn(process.execPath,[join(config.harnessRoot,'apps/cli/lib/bin.js'),...args],{cwd:paths.workspace,env:childEnvironment(paths.home),windowsHide:true,stdio:['ignore','pipe','pipe']});
    owner.children.add(child); child.once('exit',()=>owner.children.delete(child));
    let output=''; const collect=data=>{output=(output+data.toString()).slice(-12000);}; child.stdout.on('data',collect);child.stderr.on('data',collect);
    const timer=setTimeout(()=>{stopChild(child);reject(new Error('HARNESS_SETUP_TIMEOUT'));},config.startupTimeoutMs);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('HARNESS_SETUP_FAILED'));});
    child.once('exit',code=>{clearTimeout(timer);if(code===0)resolvePromise();else{writeFileSync(join(paths.directory,'setup-diagnostic.log'),redactDiagnostic(output),{mode:0o600});reject(new Error('HARNESS_SETUP_FAILED'));}});
  });
}
async function prepare(config, paths, owner) {
  mkdirSync(paths.home,{recursive:true,mode:0o700});mkdirSync(paths.workspace,{recursive:true,mode:0o700});
  const profile=join(paths.home,'profiles','chengye-oa'), marker=join(profile,'chengye-integration.json');
  if (!existsSync(marker)) {
    for (const plugin of [join(config.harnessRoot,'packages/bundle/web-app'),join(config.harnessRoot,'packages/product/product-bundle'),join(HERE,'bridge-plugin')]) await cli(config,paths,['plugin','--profile','chengye-oa','add','link:'+plugin.replaceAll('\\','/')],owner);
    const patch=[{id:'agent-presets',config:{default:'chengye-legal',roots:[],includeShippedRoot:true,includeUserRoot:true}},{id:'product-knowledge',config:{ocrEnabled:false,retrievalMode:'lexical'}}];
    // JSON is valid YAML; installation defaults belong to this new personal profile.
    writeFileSync(join(profile,'cordis.patch.yml'),JSON.stringify(patch,null,2)+'\n',{flag:'w',mode:0o600});
    const preset=join(paths.home,'.agent-presets','chengye-legal');mkdirSync(preset,{recursive:true});
    for(const file of ['agent.cordis.yml','preset.yml']) if(!existsSync(join(preset,file)))writeFileSync(join(preset,file),readFileSync(join(HERE,'legal-preset',file)),{flag:'wx'});
    writeFileSync(marker,JSON.stringify({version:'1.1.0',harnessVersion:validateInstallation(config.harnessRoot)},null,2)+'\n',{flag:'wx'});
  }
}
function canonicalPath(path) {
  let current=resolve(path);const missing=[];
  while(!existsSync(current)){const parent=dirname(current);if(parent===current)throw new Error('DATA_ROOT_INVALID');missing.unshift(current.slice(parent.length).replace(/^[\\/]+/,''));current=parent;}
  return join(realpathSync(current),...missing);
}
export class HarnessRuntime {
  constructor(config) {
    this.config=config;this.running=new Map();this.pending=new Map();this.children=new Set();this.closed=false;
    const rel=relative(canonicalPath(config.harnessRoot),canonicalPath(config.dataRoot));
    if (!rel || (!(rel==='..'||rel.startsWith('..'+sep)) && !isAbsolute(rel))) throw new Error('DATA_ROOT_INSIDE_SOURCE');
  }
  async launch(userId) {
    if(this.closed)throw new Error('HARNESS_STOPPED');
    const paths=accountPaths(this.config.dataRoot,this.config.oaApiOrigin,userId);
    if(this.running.has(paths.key))return this.running.get(paths.key).result;
    if(this.pending.has(paths.key))return this.pending.get(paths.key);
    if(this.running.size+this.pending.size>=this.config.maxInstances)throw new Error('HARNESS_INSTANCE_LIMIT');
    const task=this.start(paths);this.pending.set(paths.key,task);
    try{return await task;}finally{this.pending.delete(paths.key);}
  }
  async start(paths) {
    const version=validateInstallation(this.config.harnessRoot);
    mkdirSync(paths.directory,{recursive:true,mode:0o700});const lock=join(paths.directory,'runtime.lock');
    if(existsSync(lock)){let previous;try{previous=JSON.parse(readFileSync(lock,'utf8'));}catch{throw new Error('HARNESS_LOCK_INVALID');}if(alive(previous.ownerPid)||alive(previous.childPid))throw new Error('HARNESS_ALREADY_RUNNING');unlinkSync(lock);}
    const fd=openSync(lock,'wx',0o600);closeSync(fd);const lockId=randomUUID();writeFileSync(lock,JSON.stringify({ownerPid:process.pid,lockId}));
    const unlock=()=>{if(existsSync(lock)){const current=JSON.parse(readFileSync(lock,'utf8'));if(current.lockId===lockId)unlinkSync(lock);}};
    try {
      await prepare(this.config,paths,this);
      if(this.closed)throw new Error('HARNESS_STOPPED');
      return await new Promise((resolvePromise,reject)=>{
        const child=spawn(process.execPath,[join(this.config.harnessRoot,'apps/cli/lib/bin.js'),'--profile','chengye-oa','--host','127.0.0.1','--port','0','--no-open'],{cwd:paths.workspace,env:childEnvironment(paths.home),windowsHide:true,stdio:['ignore','pipe','pipe']});
        this.children.add(child);child.once('exit',()=>this.children.delete(child));
        if(child.pid)writeFileSync(lock,JSON.stringify({ownerPid:process.pid,childPid:child.pid,lockId}));
        let output='',settled=false;
        const timer=setTimeout(()=>{settled=true;stopChild(child);unlock();reject(new Error('HARNESS_START_TIMEOUT'));},this.config.startupTimeoutMs);
        const collect=data=>{
          output=(output+data.toString()).slice(-16000);
          const match=output.match(/http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/\?token=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/);
          if(match&&!settled){settled=true;clearTimeout(timer);const result={protocol:1,url:match[0],version,dataDirectory:paths.directory};this.running.set(paths.key,{child,result,unlock});resolvePromise(result);}
        };
        child.stdout.on('data',collect);child.stderr.on('data',collect);
        child.once('error',()=>{clearTimeout(timer);unlock();if(!settled){settled=true;reject(new Error('HARNESS_START_FAILED'));}});
        child.once('exit',()=>{clearTimeout(timer);unlock();if(this.running.get(paths.key)?.child===child)this.running.delete(paths.key);writeFileSync(join(paths.directory,'runtime-diagnostic.log'),redactDiagnostic(output),{mode:0o600});if(!settled){settled=true;reject(new Error('HARNESS_START_FAILED'));}});
      });
    } catch(e) {unlock();throw e;}
  }
  stop(userId) { const paths=accountPaths(this.config.dataRoot,this.config.oaApiOrigin,userId);const current=this.running.get(paths.key);if(current){stopChild(current.child);current.unlock();this.running.delete(paths.key);} }
  close() { this.closed=true;for(const child of this.children)stopChild(child);for(const current of this.running.values()){stopChild(current.child);current.unlock();}this.running.clear(); }
}
