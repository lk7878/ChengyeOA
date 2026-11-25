// Upload originals to the authenticated owner's OA files, then attach the saved
// version to this task. Generated outputs still require explicit confirmation.
export async function uploadTaskFile(taskId, file, state, progress, browser=window) {
 const base=`/api/tasks/${taskId}/material-uploads`
 const call=async(url,options={})=>{
  const r=await browser.fetch(url,{credentials:'include',signal:state.controller?.signal,...options}),data=await r.json().catch(()=>({}))
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
 progress(100);state.finalizing=true;progress(100)
 return call(url+'/complete',post({}))
}

export function bindOaUpload(ctx,inputActions,browser=window,anchor) {
 const taskId=/^\/harness\/([a-f0-9-]{36})(?:\/|$)/i.exec(browser.location.pathname)?.[1]
 if(!taskId||!inputActions)return()=>{}
 const doc=browser.document;let dialog=null,busy=0,disposed=false,timer=null,badgeTimer=null
 const badge=doc.createElement('button');badge.className='oa-material-badge';badge.type='button';badge.hidden=true;badge.onclick=()=>anchor?.click();anchor?.after(badge)
 const updateBadge=data=>{const rows=data.items||[],pending=rows.filter(r=>['QUEUED','PARSING','SAVED'].includes(r.status)),failed=rows.filter(r=>['FAILED','INTERRUPTED'].includes(r.status));badge.hidden=!rows.length;badge.textContent=pending.length?`材料解析中 ${pending.length} 份`:failed.length?`材料需处理 ${failed.length} 份`:`材料 ${rows.length} 份 · 可读取`;return pending.length>0}
 const poll=async()=>{let active=false;try{if(!dialog&&!doc.hidden){const r=await browser.fetch(`/api/tasks/${taskId}/materials`,{credentials:'include'});if(r.ok)active=updateBadge(await r.json());else if([401,403,404].includes(r.status)){badge.textContent='材料访问已失效';badge.hidden=false;return}}}catch{}finally{if(!disposed)badgeTimer=browser.setTimeout(poll,active?5000:15000)}}
 void poll()
 const click=event=>{
  const button=event.target.closest?.('.oa-upload-trigger')
  if(!button||button!==anchor||button.disabled)return
  event.preventDefault();event.stopImmediatePropagation()
  if(dialog){dialog.focus();return}
  const insertion=inputActions.captureInsertion()
  dialog=doc.createElement('dialog');dialog.className='oa-upload-dialog';dialog.dataset.oaUpload='';dialog.setAttribute('aria-label','上传文件到 OA 和当前任务')
  const title=doc.createElement('h2');title.textContent='上传任务材料'
  const hint=doc.createElement('p');hint.textContent='选择的文件将保存到承业空间 → 我的资源，并加入当前任务。解析进度会在下方显示；只有标记可读取的内容才可作为引用。'
  const picker=doc.createElement('input');picker.type='file';picker.multiple=true;picker.setAttribute('aria-label','选择上传文件')
  const list=doc.createElement('div');list.className='oa-upload-list';list.setAttribute('aria-live','polite')
  const status=doc.createElement('p');status.setAttribute('role','status')
  const insert=doc.createElement('button');insert.textContent='将已上传文件加入输入框';insert.disabled=true
  const close=doc.createElement('button');close.textContent='关闭'
  const saved=[];let queue=Promise.resolve()
  const materials=doc.createElement('div');materials.className='oa-material-status';materials.setAttribute('aria-live','polite')
  const request=async(url,body)=>{const r=await browser.fetch(url,{credentials:'include',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message||data.error||'材料操作失败');return data}
  const refresh=async()=>{
   try{const data=await request(`/api/tasks/${taskId}/materials`);if(!dialog)return;updateBadge(data);materials.replaceChildren();
    for(const item of data.items||[]){
     const row=doc.createElement('div'),name=doc.createElement('strong'),info=doc.createElement('span'),retry=doc.createElement('button'),remove=doc.createElement('button')
     name.textContent=item.name+' · v'+item.version;const labels={SAVED:'已保存',QUEUED:'等待解析',PARSING:'正在解析',READY:'可读取',FAILED:'解析失败',INTERRUPTED:'解析中断'}
     info.textContent=(labels[item.status]||item.status)+` · ${item.done||0}/${item.total||0} 页`+(item.startedAt?' · 已用 '+Math.max(0,Math.round((Date.parse(item.completedAt||new Date().toISOString())-Date.parse(item.startedAt))/1000))+' 秒':'')+(item.error?' · '+item.error:'')
     retry.textContent='重试失败页';retry.hidden=!['FAILED','INTERRUPTED'].includes(item.status);retry.onclick=async()=>{retry.disabled=true;try{await request(`/api/tasks/${taskId}/materials/retry`,{fileId:item.fileId,version:item.version});await refresh()}catch(e){status.textContent=e.message}finally{retry.disabled=false}}
     remove.textContent='从任务移除';remove.onclick=async()=>{if(!browser.confirm('仅从当前任务移除，OA 原文件保留。正在运行的会话将结束，需重新打开；历史回答不变。继续？'))return;remove.disabled=true;try{const result=await request(`/api/tasks/${taskId}/materials/remove`,{fileId:item.fileId,version:item.version});for(let i=saved.length-1;i>=0;i--)if(saved[i].fileId===item.fileId&&saved[i].version===item.version)saved.splice(i,1);insert.disabled=busy>0||!saved.length;status.textContent=result.message;await refresh()}catch(e){status.textContent=e.message}finally{remove.disabled=false}}
     row.append(name,info,retry,remove);materials.append(row)
    }
   }catch(e){if(dialog)status.textContent=e.message}
  }
  void refresh();timer=browser.setInterval(()=>void refresh(),3000)
  const dismiss=()=>{if(busy){status.textContent='文件正在上传，请等待完成或失败后关闭。';return}browser.clearInterval(timer);dialog?.close();dialog?.remove();dialog=null;button.focus()}
  close.onclick=dismiss;dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss()})
  insert.onclick=()=>{
   const text='\n'+saved.map(f=>`已上传任务材料：${f.name}（${f.path}）`).join('\n')+'\n'
   if(!inputActions.insertText(text,insertion)){status.textContent='输入内容已变化。文件已保存并加入任务，可关闭窗口后在文件列表查看。';return}
   inputActions.persistDraft();dismiss()
  }
  picker.onchange=()=>{
   for(const file of picker.files||[]){
    const row=doc.createElement('div'),name=doc.createElement('strong'),message=doc.createElement('span'),retry=doc.createElement('button'),cancel=doc.createElement('button'),state={controller:new AbortController()}
    name.textContent=file.name;retry.textContent='重试';retry.hidden=true;cancel.textContent='取消上传';row.append(name,message,retry,cancel);list.append(row)
    cancel.onclick=async()=>{if(state.finalizing)return;state.cancelled=true;state.controller.abort();cancel.disabled=true;if(state.id){try{const r=await browser.fetch(`/api/tasks/${taskId}/material-uploads/${state.id}`,{method:'DELETE',credentials:'include'});if(!r.ok)throw Error('取消未完成，请重试');message.textContent='已取消上传'}catch(e){message.textContent=e.message;state.cancelled=false;retry.hidden=false}}else message.textContent='已取消上传'}
    const run=async()=>{if(disposed||state.cancelled){busy--;insert.disabled=busy>0||!saved.length;return}message.textContent='正在上传…'
     try{
      const result=await uploadTaskFile(taskId,file,state,n=>{cancel.disabled=Boolean(state.finalizing);message.textContent=`上传 ${n}% · 正在保存并加入任务…`},browser)
      if(disposed)return
      saved.push(result);cancel.hidden=true;message.textContent='已保存到 OA · 已加入当前任务';void refresh()
     }catch(error){if(!disposed&&!state.cancelled){message.textContent=error.message;retry.hidden=false}}
     finally{busy--;if(!disposed)insert.disabled=busy>0||!saved.length}
    }
    const enqueue=()=>{busy++;retry.hidden=true;insert.disabled=true;message.textContent='等待上传…';queue=queue.then(run)}
    retry.onclick=()=>{state.cancelled=false;state.controller=new AbortController();enqueue()};enqueue()
   }
   picker.value=''
  }
  dialog.append(title,hint,picker,list,materials,status,insert,close);doc.body.append(dialog);dialog.showModal()
 }
 doc.addEventListener('click',click,true)
 return()=>{disposed=true;browser.clearInterval(timer);browser.clearTimeout(badgeTimer);badge.remove();doc.removeEventListener('click',click,true);dialog?.remove();dialog=null}
}
