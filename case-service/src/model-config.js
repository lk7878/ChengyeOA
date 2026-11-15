import {readFileSync,existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import yaml from '../../runtime/upstream/harness/node_modules/js-yaml/index.js'
const root=fileURLToPath(new URL('../..',import.meta.url))
// Read existing authorized configuration only on the server; never mount its secrets in tasks.
export function loadModelConfig(){
 const home=process.env.SOURCE_DSH_HOME||path.join(root,'.dsh'),env={}
 if(existsSync(path.join(home,'.env')))for(const line of readFileSync(path.join(home,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'')}
 if(!existsSync(path.join(home,'settings.yaml')))return null
 const config=yaml.load(readFileSync(path.join(home,'settings.yaml'),'utf8')),route=config['agent-default-model'],provider=config['llm-pi-ai']?.providers?.[route?.provider]
 if(!provider)return null
 process.env.CHAT_BASE_URL ||= provider.baseURL
 process.env.CHAT_API_KEY ||= process.env[provider.apiKeyEnv]||env[provider.apiKeyEnv]||''
 process.env.CHAT_MODEL ||= route.model
 process.env.OCR_BASE_URL ||= provider.baseURL
 process.env.OCR_API_KEY ||= process.env.CHAT_API_KEY
 process.env.OCR_MODEL ||= process.env.RECORD_PARSE_MODEL||route.model
 return {route,provider:{...provider,models:provider.models?.map(model=>({...model,name:model.id})),apiKeyEnv:'OA_TASK_MODEL_KEY',baseURL:'http://127.0.0.1:8090/llm/v1',headers:{}}}
}
export const modelConfig=loadModelConfig()
