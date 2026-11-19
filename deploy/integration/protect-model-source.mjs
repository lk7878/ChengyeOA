// Run after registry migration. Use --restore before rolling back to a release
// that predates encrypted bootstrap values. Neither operation prints secrets.
import {readFileSync,renameSync,writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import yaml from '../../runtime/upstream/harness/node_modules/js-yaml/index.js'
import {sourceSecret} from '../../case-service/src/source-secrets.js'
const root=fileURLToPath(new URL('../..',import.meta.url))
const dir=process.env.SOURCE_DSH_HOME||path.join(root,'.dsh')
const data=process.env.DATA_DIR||path.join(root,'data/integration')
const seal=process.argv[2]==='--seal'
if(!seal&&process.argv[2]!=='--restore')throw Error('需要 --seal 或 --restore')
const change=(value,field)=>sourceSecret(value,field,data,seal)
const envFile=path.join(dir,'.env'),settingsFile=path.join(dir,'settings.yaml')
const env=readFileSync(envFile,'utf8'),settings=yaml.load(readFileSync(settingsFile,'utf8'))
const providers=settings['llm-pi-ai']?.providers||{}
const credentialNames=new Set(Object.values(providers).map(p=>p.apiKeyEnv).filter(Boolean))
// Older local providers may store the Bearer token inline instead of naming its environment key.
if(providers.ollama)credentialNames.add('OLLAMA_API_KEY')
for(const [id,provider] of Object.entries(providers)){
 if(provider.headers?.Authorization)provider.headers.Authorization=change(provider.headers.Authorization,'header:'+id)
}
const rewritten=env.replace(/^([A-Z_][A-Z0-9_]*_KEY)=(.*)$/gm,(_line,name,raw)=>{
 if(!credentialNames.has(name))return _line
 const value=raw.trim().replace(/^['"]|['"]$/g,'')
 return name+'='+change(value,name)
})
for(const [file,text] of [[envFile,rewritten],[settingsFile,yaml.dump(settings,{lineWidth:-1})]]){
 const tmp=file+'.'+randomUUID()
 writeFileSync(tmp,text,{flag:'wx',mode:0o600,flush:true});renameSync(tmp,file)
}
