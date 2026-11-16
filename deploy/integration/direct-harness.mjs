/** Starts the task bridge and Harness without a private network namespace. */
import {spawn} from 'node:child_process'
const node=process.execPath
const [bridge,engineBin,publicUrl,trustedHost]=process.argv.slice(2)
const bridgeProc=spawn(node,[bridge],{stdio:'inherit',env:process.env})
const harness=spawn(node,[engineBin,'web','--host','127.0.0.1','--port',process.env.OA_HARNESS_PORT||'3081','--no-open','--public-url',publicUrl,'--trusted-host',trustedHost],{stdio:'inherit',env:process.env})
let stopping=false
function stop(){if(stopping)return;stopping=true;bridgeProc.kill('SIGTERM');harness.kill('SIGTERM')}
process.on('SIGTERM',()=>{stop();setTimeout(()=>process.exit(143),800)})
process.on('SIGINT',()=>{stop();setTimeout(()=>process.exit(130),800)})
harness.on('exit',code=>{stop();process.exit(code??1)})
bridgeProc.on('exit',code=>{if(!stopping&&code){stop();process.exit(code)}})
