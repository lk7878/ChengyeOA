// Upload originals to the authenticated owner's OA files, then attach the saved
// version to this task. Generated outputs still require explicit confirmation.
export async function uploadTaskFile(taskId, file, state, progress, browser=window) {
 const base=`/api/tasks/${taskId}/material-uploads`
 const call=async(url,options={})=>{
  const r=await browser.fetch(url,{credentials:'include',...options}),data=await r.json().catch(()=>({}))
  if(!r.ok)throw Error(data.message||data.error||'上传失败，请重试')
  return data
 }
 const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 if(!state.id)state.id=(await call(base,post({name:file.name,size:file.size}))).id
 const url=base+'/'+state.id,status=await call(url)
 if(!Number.isSafeInteger(status.chunkSize)||status.chunkSize<1||status.chunkSize>4*1024*1024||!Number.isSafeInteger(status.offset)||status.offset<0||status.offset>file.size)throw Error('上传状态无效，请重新打开上传窗口')
 for(let offset=status.offset;offset<file.size;){
  const bytes=file.slice(offset,offset+status.chunkSize)
  const next=await call(url+'/chunk?offset='+offset,{method:'PUT',headers:{'content-type':'application/octet-stream'},body:bytes})
  if(!Number.isSafeInteger(next.offset)||next.offset<=offset||next.offset>file.size)throw Error('上传进度异常，请重试')
  offset=next.offset;progress(Math.round(offset/file.size*100))
 }
 progress(100)
 return call(url+'/complete',post({}))
}

export function bindOaUpload(ctx,inputActions,browser=window,anchor) {
 const taskId=/^\/harness\/([a-f0-9-]{36})(?:\/|$)/i.exec(browser.location.pathname)?.[1]
 if(!taskId||!inputActions)return()=>{}
 const doc=browser.document;let dialog=null,busy=0,disposed=false
 const click=event=>{
  const button=event.target.closest?.('.oa-upload-trigger')
  if(!button||button!==anchor||button.disabled)return
  event.preventDefault();event.stopImmediatePropagation()
  if(dialog){dialog.focus();return}
  const insertion=inputActions.captureInsertion()
  dialog=doc.createElement('dialog');dialog.className='oa-upload-dialog';dialog.dataset.oaUpload='';dialog.setAttribute('aria-label','上传文件到 OA 和当前任务')
  const title=doc.createElement('h2');title.textContent='上传任务材料'
  const hint=doc.createElement('p');hint.textContent='选择的文件将保存到承业空间 → 我的资源，并加入当前任务。上传不等于已解析；请在发送前核对材料。'
  const picker=doc.createElement('input');picker.type='file';picker.multiple=true;picker.setAttribute('aria-label','选择上传文件')
  const list=doc.createElement('div');list.className='oa-upload-list';list.setAttribute('aria-live','polite')
  const status=doc.createElement('p');status.setAttribute('role','status')
  const insert=doc.createElement('button');insert.textContent='将已上传文件加入输入框';insert.disabled=true
  const close=doc.createElement('button');close.textContent='关闭'
  const saved=[];let queue=Promise.resolve()
  const dismiss=()=>{if(busy){status.textContent='文件正在上传，请等待完成或失败后关闭。';return}dialog?.close();dialog?.remove();dialog=null;button.focus()}
  close.onclick=dismiss;dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss()})
  insert.onclick=()=>{
   const text='\n'+saved.map(f=>`已上传任务材料：${f.name}（${f.path}）`).join('\n')+'\n'
   if(!inputActions.insertText(text,insertion)){status.textContent='输入内容已变化。文件已保存并加入任务，可关闭窗口后在文件列表查看。';return}
   inputActions.persistDraft();dismiss()
  }
  picker.onchange=()=>{
   for(const file of picker.files||[]){
    const row=doc.createElement('div'),name=doc.createElement('strong'),message=doc.createElement('span'),retry=doc.createElement('button'),state={}
    name.textContent=file.name;retry.textContent='重试';retry.hidden=true;row.append(name,message,retry);list.append(row)
    const run=async()=>{if(disposed){busy--;return}message.textContent='正在上传…'
     try{
      const result=await uploadTaskFile(taskId,file,state,n=>{message.textContent=`上传 ${n}% · 正在保存并加入任务…`},browser)
      if(disposed)return
      saved.push(result);message.textContent='已保存到 OA · 已加入当前任务'
     }catch(error){if(!disposed){message.textContent=error.message;retry.hidden=false}}
     finally{busy--;if(!disposed)insert.disabled=busy>0||!saved.length}
    }
    const enqueue=()=>{busy++;retry.hidden=true;insert.disabled=true;message.textContent='等待上传…';queue=queue.then(run)}
    retry.onclick=enqueue;enqueue()
   }
   picker.value=''
  }
  dialog.append(title,hint,picker,list,status,insert,close);doc.body.append(dialog);dialog.showModal()
 }
 doc.addEventListener('click',click,true)
 return()=>{disposed=true;doc.removeEventListener('click',click,true);dialog?.remove();dialog=null}
}
