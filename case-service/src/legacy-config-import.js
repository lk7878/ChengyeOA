// One-time migration only. Runtime routing never reads YAML or model environment variables.
import {readFileSync,existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import yaml from '../../runtime/upstream/harness/node_modules/js-yaml/index.js'
export function readLegacyConfig(){
 const home=process.env.SOURCE_DSH_HOME||fileURLToPath(new URL('../../.dsh/',import.meta.url)),env={...process.env}
 const file=path.join(home,'.env');if(existsSync(file))for(const line of readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m&&!env[m[1]])env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'')}
 const settings=path.join(home,'settings.yaml'),config=existsSync(settings)?yaml.load(readFileSync(settings,'utf8')):{},route=config?.['agent-default-model'],provider=config?.['llm-pi-ai']?.providers?.[route?.provider]
 const chat={baseUrl:env.CHAT_BASE_URL||provider?.baseURL,key:env.CHAT_API_KEY||env[provider?.apiKeyEnv],modelId:env.CHAT_MODEL||route?.model}
 return {chat,ocr:{baseUrl:env.OCR_BASE_URL||chat.baseUrl,key:env.OCR_API_KEY||chat.key,modelId:env.OCR_MODEL||env.RECORD_PARSE_MODEL||chat.modelId}}
}
