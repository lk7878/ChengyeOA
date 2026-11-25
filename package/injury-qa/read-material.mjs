import {defineTool} from '@deepseek-ai/dsh-tools'
export const name='oa-read-material'
export const inject=['tools','jobs']
export function apply(ctx){
 const pendingJobs=new Map()
 const read=async(args,signal)=>{const response=await fetch('http://127.0.0.1:8090/oa/materials/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(data.error||'材料授权已失效');return data}
 ctx.tools.register(defineTool({
  name:'read_task_material',description:'列出或读取本任务已授权的固定版本材料。支持 Word、PDF、图片和文本。返回真实解析状态、原文件页码及段落编号。图片描述不是原文引文。解析未完成时登记后台任务，完成后会通知当前会话继续分析，无需让用户反复询问。',
  parameters:{fileId:{type:'string'},version:{type:'number'},page:{type:'number',description:'原文件页码，默认1；Word返回逻辑位置'},paragraph:{type:'number',description:'起始段落，默认1'}},
  output:{schema:{type:'object',additionalProperties:true},render:(_a,value)=>[{type:'text',text:JSON.stringify(value)}]},
  async execute(args,exec){
   const data=await read(args)
   const pending=args.fileId?['SAVED','QUEUED','PARSING'].includes(data.status):data.items?.some(r=>['SAVED','QUEUED','PARSING'].includes(r.status))
   if(pending&&exec?.agent){
    const key=JSON.stringify([exec.agent,args.fileId,args.version]);if(pendingJobs.has(key))return {...data,jobId:pendingJobs.get(key),note:'等待已登记的材料解析任务完成'}
    const cancellation=new AbortController();let latest=data
    const jobId=ctx.jobs.start({kind:'parse',label:'任务材料解析',owner:exec.agent,run:job=>({cancel:()=>cancellation.abort(),done:(async()=>{
     const deadline=Date.now()+30*60*1000
     while(Date.now()<deadline){await new Promise(r=>setTimeout(r,2000));cancellation.signal.throwIfAborted();latest=await read(args,cancellation.signal);job.updateProgress(args.fileId?`${latest.done||0}/${latest.total||0} 页`:JSON.stringify(latest.items?.map(r=>({name:r.name,status:r.status,done:r.done,total:r.total}))))
      const active=args.fileId?['SAVED','QUEUED','PARSING'].includes(latest.status):latest.items?.some(r=>['SAVED','QUEUED','PARSING'].includes(r.status))
      if(!active)return {status:'completed',detail:'材料解析状态已更新',result:JSON.stringify(latest)+'\n继续完成用户已经提出的分析请求；通过 read_task_material 分页读取正文，引用文件名、版本、页码和段落。失败材料须明确告知，不可声称已读。'}
     }
     return {status:'failed',detail:'等待超时',result:'材料解析尚未完成，请查看材料状态后重试。'}
    })().catch(e=>({status:'failed',detail:e.message,result:e.message})).finally(()=>pendingJobs.delete(key))})})
    pendingJobs.set(key,jobId)
    return {...data,jobId,note:'解析进行中，后台任务完成会通知当前会话；不要声称分析已经完成。'}
   }
   return data
  }
 }))
}
