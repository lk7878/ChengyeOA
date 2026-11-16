import {useAuthStore} from '@/stores/authStore';
import {uploadFile,downloadVersion} from './file-transfer';
import { useCallback,useEffect,useRef,useState } from 'react';
import { Alert,Button,Checkbox,Dropdown,Input,Select,Space,Table,message } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import Modal from '@/components/DraggableModal';
import request from '@/api/request';
import {get,post,patch,errorMessage} from '../workspaces/api';
type Item={id:string;name:string;kind:string;size:number;level:number;version:number;contentVersion:number;parentId:string|null};
type Grant={principalType:string;principalId:string;role:string;rowScope:string;canCreate:boolean;hiddenFields:string[];readonlyFields:string[]};
type Sharing={id:string;name:string;version:number;ownerId:string;labels:Record<string,string>;path:{id:string;name:string}[];policy:{restricted:boolean;grants:Grant[]}};
export default function PersonalFiles({scope}:{scope:'mine'|'shared'}){
  const authorization=useAuthStore(s=>s.authorization);
  const [allFiles,setAllFiles]=useState<(Item&{ownerId:string})[]>(),[allError,setAllError]=useState('');
  const [parentId,setParent]=useState<string>(),[data,setData]=useState<{items:Item[];path:{id:string;name:string}[];canUpload:boolean}>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,bump]=useState(0);
  const [sharing,share]=useState<Sharing>(),[people,setPeople]=useState<{value:string;label:string}[]>([]),[keyword,search]=useState('');
  const [dialog,setDialog]=useState<{kind:'folder'|'rename';item?:Item}>(),[name,setName]=useState('');
  const fileInput=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null);
  const [replacing,setReplacing]=useState<{file:Item;upload?:File}>();
  const [history,setHistory]=useState<{file:Item;versions:{version:number;name:string;size:number;sha256:string;parseStatus:string;createdAt:string}[]}>();
  const [progress,setProgress]=useState<Record<string,string>>({});
  const [selected,setSelected]=useState<string[]>([]),[deleting,setDeleting]=useState<Item[]>(),[trash,setTrash]=useState<{id:string;name:string;version:number;deletedAt:string}[]>();
  const [failed,setFailed]=useState<File[]>([]);
  useEffect(()=>{let active=true;void get<typeof data>('/personal-files?'+new URLSearchParams({scope,...(parentId?{parentId}:{})})).then(d=>{if(active){setData(d);setSelected([]);setError('');}}).catch(e=>{if(active){setData(undefined);setError(errorMessage(e));}});return()=>{active=false;};},[scope,parentId,revision]);
  const sharingId=sharing?.id;
  useEffect(()=>{if(!sharingId)return;let active=true;const timer=setTimeout(()=>{void get<typeof people>('/personal-files/people?keyword='+encodeURIComponent(keyword)).then(p=>{if(active)setPeople(p);}).catch(e=>message.error(errorMessage(e)));},200);return()=>{active=false;clearTimeout(timer);};},[sharingId,keyword]);
  const refresh=useCallback(()=>bump(n=>n+1),[]);
  const upload=async(files:FileList|File[]|null)=>{if(!files?.length)return;setBusy(true);setError('');let completed=0;const failures:File[]=[];const folders=new Map<string,string>();try{
    for(const f of Array.from(files)){
      let destination=parentId;const parts=f.webkitRelativePath?.split('/').slice(0,-1)??[];let key='';
      for(const part of parts){key+='/'+part;if(!folders.has(key)){const folder=await post<{id:string}>('/personal-files',{name:part,kind:'FOLDER',parentId:destination??null});folders.set(key,folder.id);}destination=folders.get(key);}
      try{await uploadFile(f,{parentId:destination},offset=>setProgress(p=>({...p,[f.name]:Math.round(offset/Math.max(f.size,1)*100)+'%'})));completed++;setProgress(p=>({...p,[f.name]:'已保存 · 待解析'}));}
      catch(e){failures.push(f);setProgress(p=>({...p,[f.name]:errorMessage(e)}));}
    }message.success('已上传'+completed+'个文件');
  }catch(e){setError('已完成'+completed+'个文件，其余未上传：'+errorMessage(e));}finally{setFailed(failures);setBusy(false);refresh();if(fileInput.current)fileInput.current.value='';if(folderInput.current)folderInput.current.value='';}};
  return <section style={{border:'1px solid #e5e8ee',borderRadius:8,padding:16,marginBottom:20}} aria-label="个人文件">
    {authorization?.isSystemSuperAdmin&&<Button onClick={async()=>{try{const r=await get<{items:(Item&{ownerId:string})[]}>('/all-personal-files');setAllFiles(r.items);setAllError('');}catch(e){setAllError(errorMessage(e));}}}>全员文件管理（只读审计）</Button>}
    {allError&&<Alert type="error" title={allError}/>}
    <Drawer title="全员文件管理 · 跨用户访问已记录审计" open={!!allFiles} onClose={()=>setAllFiles(undefined)} width={900}><p>仅查看和下载，修改、删除及批量导出不随全局查看权限授予。私人会话不在此入口内。</p><Table rowKey="id" dataSource={allFiles} columns={[{title:'文件',dataIndex:'name'},{title:'所有者',dataIndex:'ownerId'},{title:'操作',render:(_,r)=>r.kind==='FILE'&&<Button onClick={()=>void downloadVersion(r.id,r.contentVersion,r.name,true).catch(e=>message.error(errorMessage(e)))}>查看 / 下载</Button>}]}/></Drawer>
    <h2>{scope==='shared'?'共享给我的文件':'我的文件'}</h2>
    {error&&<Alert type="error" title={error}/>}<Space wrap>
      <Button onClick={()=>setParent(undefined)}>文件根目录</Button>{data?.path.map(p=><Button key={p.id} type="link" onClick={()=>setParent(p.id)}>{p.name}</Button>)}
      {data?.canUpload&&<><Button loading={busy} onClick={()=>fileInput.current?.click()}>上传文件</Button><Button disabled={busy} onClick={()=>folderInput.current?.click()}>上传文件夹</Button><Button disabled={busy} onClick={()=>{setName('');setDialog({kind:'folder'});}}>新建文件夹</Button></>}
      <Button disabled={busy} onClick={refresh}>刷新文件</Button>
      <Button danger disabled={busy||!selected.length} onClick={()=>setDeleting((data?.items??[]).filter(i=>selected.includes(i.id)))}>删除所选（{selected.length}）</Button>
      {scope==='mine'&&<Button disabled={busy} onClick={()=>void get<{items:NonNullable<typeof trash>}>('/personal-files/trash').then(r=>setTrash(r.items)).catch(e=>message.error(errorMessage(e)))}>回收站</Button>}
    </Space>
    <p style={{color:'#667085',marginTop:8}}>可在“更多”中更新文件或管理分享。文件更新后保留旧版本，有多个版本时可查看历史版本。</p>
    <input hidden type="file" multiple ref={fileInput} onChange={e=>void upload(e.target.files)}/><input hidden type="file" multiple {...{webkitdirectory:''}} ref={folderInput} onChange={e=>void upload(e.target.files)}/>
    {Object.entries(progress).map(([file,state])=><p key={file}>{file}：{state}</p>)}
    {failed.length>0&&<Button disabled={busy} onClick={()=>void upload(failed)}>重试失败文件（续传）</Button>}
    <Table<Item> style={{marginTop:12}} rowKey="id" dataSource={data?.items??[]} pagination={{pageSize:10}} rowSelection={{selectedRowKeys:selected,onChange:keys=>setSelected(keys.map(String)),getCheckboxProps:r=>({disabled:busy||r.kind!=='FILE'||r.level<3})}} columns={[
      {title:'文件名称',dataIndex:'name',render:(_,r)=>r.kind==='FOLDER'?<Button type="link" onClick={()=>setParent(r.id)}>📁 {r.name}</Button>:r.name},
      {title:'权限',render:(_,r)=>['无权限','只读','编辑','管理'][r.level]},
      {title:'大小',render:(_,r)=>r.kind==='FILE'?Math.ceil(r.size/1024)+' KB':'文件夹'},
      {title:'操作',width:180,render:(_,r)=><Space>
        {r.kind==='FILE'&&<Button onClick={()=>void downloadVersion(r.id,r.contentVersion,r.name).catch(e=>message.error(errorMessage(e)))}>下载</Button>}
        {(r.level>=2||(r.kind==='FILE'&&r.contentVersion>1))&&<Dropdown trigger={['click']} menu={{items:[
          ...(r.kind==='FILE'&&r.level>=2?[{key:'update',label:'更新文件'}]:[]),
          ...(r.kind==='FILE'&&r.contentVersion>1?[{key:'history',label:'历史版本'}]:[]),
          ...(r.level>=2?[{key:'rename',label:'重命名'}]:[]),
          ...(r.level>=3?[{key:'share',label:'分享与权限'}]:[]),
          ...(r.kind==='FILE'&&r.level>=3?[{key:'delete',label:'删除',danger:true}]:[]),
        ],onClick:({key})=>{
          if(key==='update')setReplacing({file:r});
          if(key==='history')void get<NonNullable<typeof history>['versions']>('/personal-files/'+r.id+'/versions').then(versions=>setHistory({file:r,versions})).catch(e=>message.error(errorMessage(e)));
          if(key==='rename'){setName(r.name);setDialog({kind:'rename',item:r});}
          if(key==='share')void get<Sharing>('/personal-files/'+r.id+'/access').then(share).catch(e=>message.error(errorMessage(e)));
          if(key==='delete')setDeleting([r]);
        }}}><Button disabled={busy} aria-label={r.name+'的更多操作'}>更多</Button></Dropdown>}
      </Space>},
    ]}/>
    <Modal title="确认删除文件" open={!!deleting} confirmLoading={busy} onCancel={()=>setDeleting(undefined)} okText="移入回收站" onOk={async()=>{if(!deleting?.length)return;setBusy(true);try{await post('/personal-files/delete',{files:deleting.map(({id,version})=>({id,version}))});setDeleting(undefined);setHistory(undefined);setSelected([]);refresh();message.success('文件已移入所有者的回收站');}catch(e){message.error(errorMessage(e));}finally{setBusy(false);}}}><p>将删除以下 {deleting?.length} 个文件。共享访问及任务材料读取将失效，正在引用这些材料的 AI 任务可能中断；已发布的知识快照与正式归档不受影响。文件所有者可从回收站恢复。</p><ul>{deleting?.map(f=><li key={f.id}>{f.name}</li>)}</ul></Modal>
    <Drawer title="我的文件回收站" open={!!trash} onClose={()=>setTrash(undefined)} width={620}><p>删除的文件和内容版本保留，可恢复到原目录。恢复后沿用原有分享权限。</p><Table rowKey="id" dataSource={trash} columns={[{title:'文件名称',dataIndex:'name'},{title:'操作',render:(_,r)=><Button disabled={busy} onClick={async()=>{setBusy(true);try{await post('/personal-files/'+r.id+'/restore',{version:r.version});setTrash(p=>p?.filter(i=>i.id!==r.id));refresh();message.success('文件已恢复');}catch(e){message.error(errorMessage(e));}finally{setBusy(false);}}}>恢复</Button>}]}/></Drawer>
    <Drawer title={'历史版本 · '+(history?.file.name??'')} open={!!history} onClose={()=>setHistory(undefined)} width={620}><p>更新文件会保留旧版本。已有 AI 任务和已投稿知识继续使用当时选定的版本。</p>{history?.versions.map((v,index)=><section key={v.version} style={{marginBottom:20,paddingBottom:16,borderBottom:'1px solid #e5e8ee'}}><h3>版本 {v.version}{index===0?'（最新）':''}</h3><p>{v.name} · {Math.ceil(v.size/1024)} KB</p><p>保存于：{new Date(v.createdAt).toLocaleString('zh-CN',{hour12:false})}</p><Button onClick={()=>void downloadVersion(history.file.id,v.version,v.name).catch(e=>message.error(errorMessage(e)))}>下载此版本</Button><details style={{marginTop:12}}><summary style={{cursor:'pointer'}}>技术信息</summary><p style={{overflowWrap:'anywhere'}}>文件校验码（SHA-256）：{v.sha256}</p><p>解析状态：{v.parseStatus==='PARSED'?'已解析':'待任务处理'}；模型可读性由任务工具确认。</p></details></section>)}</Drawer>
    <Modal title="更新文件" open={!!replacing} destroyOnHidden confirmLoading={busy} closable={!busy} maskClosable={!busy} keyboard={!busy} cancelButtonProps={{disabled:busy}} okButtonProps={{disabled:!replacing?.upload}} okText="确认更新" cancelText="取消" onCancel={()=>{if(!busy)setReplacing(undefined);}} onOk={async()=>{
      if(!replacing?.upload)return;const {file,upload:next}=replacing;setBusy(true);
      try{await uploadFile(next,{fileId:file.id,version:file.version},offset=>setProgress(p=>({...p,[next.name]:Math.round(offset/Math.max(next.size,1)*100)+'%'})));setProgress(p=>({...p,[next.name]:'更新完成'}));message.success('文件已更新，旧版本和分享权限已保留');setReplacing(undefined);refresh();}
      catch(e){message.error(errorMessage(e));}finally{setBusy(false);}
    }}><p>正在更新：{replacing?.file.name}</p><Alert type="info" title="旧版本会保留，已有 AI 任务和已投稿知识不会自动改用新版。原有分享权限保持不变。"/><p>请选择同一份材料的修订文件；不同材料请使用“上传文件”。</p><label>选择修订文件<input type="file" disabled={busy} style={{display:'block',marginTop:8,maxWidth:'100%'}} onChange={e=>{const upload=e.target.files?.[0];setReplacing(p=>p&&({...p,upload}));}}/></label>{replacing?.upload&&<p>待更新文件：{replacing.upload.name} · {Math.ceil(replacing.upload.size/1024)} KB</p>}</Modal>
    <Modal title={dialog?.kind==='folder'?'新建文件夹':'重命名'} open={!!dialog} confirmLoading={busy} onCancel={()=>setDialog(undefined)} onOk={async()=>{if(!dialog)return;setBusy(true);try{if(dialog.kind==='folder')await post('/personal-files',{name,kind:'FOLDER',parentId:parentId??null});else await patch('/personal-files/'+dialog.item!.id,{name,version:dialog.item!.version});setDialog(undefined);refresh();}catch(e){message.error(errorMessage(e));}finally{setBusy(false);}}}><Input aria-label="文件名称" value={name} onChange={e=>setName(e.target.value)} maxLength={150}/></Modal>
    <Drawer title={'分享与权限 · '+(sharing?.name??'')} open={!!sharing} onClose={()=>share(undefined)} width={620} extra={<Button type="primary" loading={busy} onClick={async()=>{if(!sharing)return;setBusy(true);try{await request.put('/v1/personal-files/'+sharing.id+'/access',{version:sharing.version,policy:sharing.policy},{suppressGlobalError:true});share(undefined);refresh();}catch(e){message.error(errorMessage(e));}finally{setBusy(false);}}}>保存分享</Button>}>
      <Alert type="info" title="仅限系统内部分享。父目录未授权或明确禁止访问时，单独分享子文件也无法访问；编辑者可修改名称、更新文件内容和上传子文件，只有管理者可配置分享。"/>
      <p>{sharing?.path.map(p=>p.name).join(' / ')}</p>
      {sharing&&<Checkbox checked={sharing.policy.restricted||sharing.path.length===1} disabled={sharing.path.length===1} onChange={e=>share({...sharing,policy:{...sharing.policy,restricted:e.target.checked}})}>仅限已列出的分享对象（仍需具备上级目录权限）</Checkbox>}
      <Select aria-label="搜索分享对象" style={{width:'100%'}} showSearch={{filterOption:false,onSearch:search}} value={null} placeholder="搜索用户、部门或角色" options={people}
        onChange={(value:string)=>{const [principalType,principalId]=value.split(':');if(!sharing||sharing.policy.grants.some(g=>g.principalType===principalType&&g.principalId===principalId))return;share({...sharing,policy:{...sharing.policy,grants:[...sharing.policy.grants,{principalType,principalId,role:'READER',rowScope:'ALL',canCreate:false,hiddenFields:[],readonlyFields:[]}]}});}}/>
      {sharing?.policy.grants.map(g=><Space key={g.principalType+g.principalId} style={{display:'flex',marginTop:12}}><span>{people.find(p=>p.value===g.principalType+':'+g.principalId)?.label??sharing.labels[g.principalType+':'+g.principalId]??(g.principalId===sharing.ownerId?'文件创建者':'已授权'+g.principalType)}</span><Select disabled={g.principalType==='USER'&&g.principalId===sharing.ownerId} value={g.role} options={[{value:'READER',label:'只读'},{value:'EDITOR',label:'编辑'},{value:'MANAGER',label:'管理'},{value:'DENY',label:'禁止访问'}]} onChange={role=>share({...sharing,policy:{...sharing.policy,grants:sharing.policy.grants.map(x=>x===g?{...x,role,canCreate:['EDITOR','MANAGER'].includes(role)}:x)}})}/>{authorization?.userId===sharing.ownerId&&g.principalType==='USER'&&g.principalId!==sharing.ownerId&&<><Button onClick={async()=>{try{await request.put('/v1/personal-files/'+sharing.id+'/publication',{userId:g.principalId,allowed:true});message.success('已授权投稿和正式归档，仍须具备文件阅读权');}catch(e){message.error(errorMessage(e));}}}>授予发布权</Button><Button onClick={async()=>{try{await request.put('/v1/personal-files/'+sharing.id+'/publication',{userId:g.principalId,allowed:false});message.success('发布权已撤销');}catch(e){message.error(errorMessage(e));}}}>撤销发布权</Button></>}
      <Button disabled={g.principalType==='USER'&&g.principalId===sharing.ownerId} onClick={()=>share({...sharing,policy:{...sharing.policy,grants:sharing.policy.grants.filter(x=>x!==g)}})}>移除</Button></Space>)}
    </Drawer>
  </section>;
}
