import '../../case-service/src/load-env.js'
import '../../case-service/src/model-config.js'
import {createTaskBroker} from '../../case-service/src/task-broker.js'
import {oa} from '../../case-service/src/oa-client.js'
import {readFile,mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {tmpdir} from 'node:os'
import path from 'node:path'
const root=process.cwd(),sessions=JSON.parse(await readFile('runtime/e2e/data/oa-sessions.json'));let token
for(const s of Object.values(sessions)){try{await oa(s.token,'/smart-case/me');token=s.token;break}catch{}}
if(!token)throw Error('Test OA session required')
const dir=await mkdtemp(path.join(tmpdir(),'oa-ocr-'));await mkdir(path.join(dir,'channel'))
const broker=await createTaskBroker({task:{inputs:[]},token,validate:async()=>{await oa(token,'/smart-case/me')},knowledge:{}})
try{await writeFile(path.join(dir,'probe.py'),`import sys,time,io,os\nsys.path.insert(0,'/app/package/record-parse')\nfrom PIL import Image,ImageDraw,ImageFont\nfrom qwen_client import QwenClient\ntime.sleep(0.5)\nim=Image.new('RGB',(1000,180),'white');ImageDraw.Draw(im).text((30,50),'SYNTHETIC OCR TEST 12345',fill='black',font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',36));b=io.BytesIO();im.save(b,format='JPEG')\ntext=QwenClient(model=os.environ['RECORD_PARSE_MODEL'],base_url='http://127.0.0.1:8090/ocr/v1',api_key='task-scoped').vision('Transcribe the text exactly.',b.getvalue())\nassert '12345' in text,text\nprint('Original OCR client via isolated scoped broker passed')\n`)
const args=['--unshare-all','--die-with-parent','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp']
for(const [src,dst]of [['runtime/bundle','/app'],['runtime/node24','/runtime'],['runtime/python-deps','/pydeps']])args.push('--ro-bind',path.join(root,src),dst)
args.push('--bind',dir,'/workspace','--bind',path.join(dir,'channel'),'/run/channel','--ro-bind',broker.socket,'/run/task-broker.sock','--clearenv','--setenv','PATH','/runtime/bin:/usr/bin:/bin','--setenv','PYTHONPATH','/pydeps','--setenv','RECORD_PARSE_MODEL',process.env.OCR_MODEL,'--setenv','RECORD_PARSE_MAX_RETRIES','1','--chdir','/workspace','/bin/sh','-c','node /app/task-bridge.mjs & exec python3 probe.py')
await new Promise((resolve,reject)=>{const c=spawn('bwrap',args,{stdio:'inherit'});c.on('error',reject);c.on('exit',code=>code?reject(Error('OCR failed '+code)):resolve())})
}finally{broker.close();await rm(dir,{recursive:true,force:true})}
