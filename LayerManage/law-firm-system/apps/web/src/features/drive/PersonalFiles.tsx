import { useCallback,useEffect,useRef,useState } from 'react';
import { Alert,Button,Checkbox,Input,Select,Space,Table,message } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import Modal from '@/components/DraggableModal';
import request from '@/api/request';
import {get,post,patch,errorMessage} from '../workspaces/api';
type Item={id:string;name:string;kind:string;size:number;level:number;version:number;parentId:string|null};
type Grant={principalType:string;principalId:string;role:string;rowScope:string;canCreate:boolean;hiddenFields:string[];readonlyFields:string[]};
type Sharing={id:string;name:string;version:number;ownerId:string;labels:Record<string,string>;path:{id:string;name:string}[];policy:{restricted:boolean;grants:Grant[]}};
export default function PersonalFiles({scope}:{scope:'mine'|'shared'}){
  const [parentId,setParent]=useState<string>(),[data,setData]=useState<{items:Item[];path:{id:string;name:string}[];canUpload:boolean}>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,bump]=useState(0);
  const [sharing,share]=useState<Sharing>(),[people,setPeople]=useState<{value:string;label:string}[]>([]),[keyword,search]=useState('');
  const [dialog,setDialog]=useState<{kind:'folder'|'rename';item?:Item}>(),[name,setName]=useState('');
  const fileInput=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null),replaceInput=useRef<HTMLInputElement>(null);
  const [replacing,setReplacing]=useState<Item>();
  useEffect(()=>{let active=true;void get<typeof data>('/personal-files?'+new URLSearchParams({scope,...(parentId?{parentId}:{})})).then(d=>{if(active){setData(d);setError('');}}).catch(e=>{if(active){setData(undefined);setError(errorMessage(e));}});return()=>{active=false;};},[scope,parentId,revision]);
  const sharingId=sharing?.id;
  useEffect(()=>{if(!sharingId)return;let active=true;const timer=setTimeout(()=>{void get<typeof people>('/personal-files/people?keyword='+encodeURIComponent(keyword)).then(p=>{if(active)setPeople(p);}).catch(e=>message.error(errorMessage(e)));},200);return()=>{active=false;clearTimeout(timer);};},[sharingId,keyword]);
  const refresh=useCallback(()=>bump(n=>n+1),[]);
  const upload=async(files:FileList|null)=>{if(!files?.length)return;if(files.length>200){message.error('每次最多上传200个文件。');return;}setBusy(true);setError('');let completed=0;const folders=new Map<string,string>();try{
    for(const f of Array.from(files)){
      let destination=parentId;const parts=f.webkitRelativePath?.split('/').slice(0,-1)??[];let key='';
      for(const part of parts){key+='/'+part;if(!folders.has(key)){const folder=await post<{id:string}>('/personal-files',{name:part,kind:'FOLDER',parentId:destination??null});folders.set(key,folder.id);}destination=folders.get(key);}
      const content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(f);});
      await post('/personal-files',{kind:'FILE',name:f.name,parentId:destination??null,content});completed++;
    }message.success('已上传'+completed+'个文件');
  }catch(e){setError('已完成'+completed+'个文件，其余未上传：'+errorMessage(e));}finally{setBusy(false);refresh();if(fileInput.current)fileInput.current.value='';if(folderInput.current)folderInput.current.value='';}};
  return <section style={{border:'1px solid #e5e8ee',borderRadius:8,padding:16,marginBottom:20}} aria-label="个人文件">
    <h2>{scope==='shared'?'共享给我的文件':'我的文件'}</h2>
    {error&&<Alert type="error" title={error}/>}<Space wrap>
      <Button onClick={()=>setParent(undefined)}>文件根目录</Button>{data?.path.map(p=><Button key={p.id} type="link" onClick={()=>setParent(p.id)}>{p.name}</Button>)}
      {data?.canUpload&&<><Button loading={busy} onClick={()=>fileInput.current?.click()}>上传文件</Button><Button disabled={busy} onClick={()=>folderInput.current?.click()}>上传文件夹</Button><Button disabled={busy} onClick={()=>{setName('');setDialog({kind:'folder'});}}>新建文件夹</Button></>}
      <Button disabled={busy} onClick={refresh}>刷新文件</Button>
    </Space>
    <p style={{color:'#667085',marginTop:8}}>支持常见文档、图片和压缩包；单个文件不超过 10 MB，每次最多 200 个。编辑权限可上传新版本，保留原分享设置。</p>
    <input hidden type="file" ref={replaceInput} onChange={async e=>{const file=e.target.files?.[0];if(!file||!replacing)return;setBusy(true);try{
      const content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
      await request.put('/v1/personal-files/'+replacing.id+'/content',{name:file.name,version:replacing.version,content},{suppressGlobalError:true});message.success('文件内容已更新，分享设置保留');refresh();
    }catch(error){message.error(errorMessage(error));}finally{setBusy(false);setReplacing(undefined);if(replaceInput.current)replaceInput.current.value='';}}}/>
    <input hidden type="file" multiple ref={fileInput} onChange={e=>void upload(e.target.files)}/><input hidden type="file" multiple {...{webkitdirectory:''}} ref={folderInput} onChange={e=>void upload(e.target.files)}/>
    <Table<Item> style={{marginTop:12}} rowKey="id" dataSource={data?.items??[]} pagination={{pageSize:10}} columns={[
      {title:'文件名称',dataIndex:'name',render:(_,r)=>r.kind==='FOLDER'?<Button type="link" onClick={()=>setParent(r.id)}>📁 {r.name}</Button>:r.name},
      {title:'权限',render:(_,r)=>['无权限','只读','编辑','管理'][r.level]},
      {title:'大小',render:(_,r)=>r.kind==='FILE'?Math.ceil(r.size/1024)+' KB':'文件夹'},
      {title:'操作',render:(_,r)=><Space>
        {r.kind==='FILE'&&<Button onClick={async()=>{try{const file=await get<{name:string;content:string}>('/personal-files/'+r.id+'/download');const bytes=Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){message.error(errorMessage(e));}}}>下载</Button>}
        {r.kind==='FILE'&&r.level>=2&&<Button disabled={busy} onClick={()=>{setReplacing(r);replaceInput.current?.click();}}>上传新版本</Button>}
        {r.level>=2&&<Button onClick={()=>{setName(r.name);setDialog({kind:'rename',item:r});}}>重命名</Button>}
        {r.level>=3&&<Button onClick={async()=>{try{share(await get<Sharing>('/personal-files/'+r.id+'/access'));}catch(e){message.error(errorMessage(e));}}}>分享与权限</Button>}
      </Space>},
    ]}/>
    <Modal title={dialog?.kind==='folder'?'新建文件夹':'重命名'} open={!!dialog} confirmLoading={busy} onCancel={()=>setDialog(undefined)} onOk={async()=>{if(!dialog)return;setBusy(true);try{if(dialog.kind==='folder')await post('/personal-files',{name,kind:'FOLDER',parentId:parentId??null});else await patch('/personal-files/'+dialog.item!.id,{name,version:dialog.item!.version});setDialog(undefined);refresh();}catch(e){message.error(errorMessage(e));}finally{setBusy(false);}}}><Input aria-label="文件名称" value={name} onChange={e=>setName(e.target.value)} maxLength={150}/></Modal>
    <Drawer title={'分享与权限 · '+(sharing?.name??'')} open={!!sharing} onClose={()=>share(undefined)} width={620} extra={<Button type="primary" loading={busy} onClick={async()=>{if(!sharing)return;setBusy(true);try{await request.put('/v1/personal-files/'+sharing.id+'/access',{version:sharing.version,policy:sharing.policy},{suppressGlobalError:true});share(undefined);refresh();}catch(e){message.error(errorMessage(e));}finally{setBusy(false);}}}>保存分享</Button>}>
      <Alert type="info" title="仅限系统内部分享。父目录未授权或明确禁止访问时，单独分享子文件也无法访问；编辑者可修改名称、更新文件内容和上传子文件，只有管理者可配置分享。"/>
      <p>{sharing?.path.map(p=>p.name).join(' / ')}</p>
      {sharing&&<Checkbox checked={sharing.policy.restricted||sharing.path.length===1} disabled={sharing.path.length===1} onChange={e=>share({...sharing,policy:{...sharing.policy,restricted:e.target.checked}})}>仅限已列出的分享对象（仍需具备上级目录权限）</Checkbox>}
      <Select aria-label="搜索分享对象" style={{width:'100%'}} showSearch={{filterOption:false,onSearch:search}} value={null} placeholder="搜索用户、部门或角色" options={people}
        onChange={(value:string)=>{const [principalType,principalId]=value.split(':');if(!sharing||sharing.policy.grants.some(g=>g.principalType===principalType&&g.principalId===principalId))return;share({...sharing,policy:{...sharing.policy,grants:[...sharing.policy.grants,{principalType,principalId,role:'READER',rowScope:'ALL',canCreate:false,hiddenFields:[],readonlyFields:[]}]}});}}/>
      {sharing?.policy.grants.map(g=><Space key={g.principalType+g.principalId} style={{display:'flex',marginTop:12}}><span>{people.find(p=>p.value===g.principalType+':'+g.principalId)?.label??sharing.labels[g.principalType+':'+g.principalId]??(g.principalId===sharing.ownerId?'文件创建者':'已授权'+g.principalType)}</span><Select disabled={g.principalType==='USER'&&g.principalId===sharing.ownerId} value={g.role} options={[{value:'READER',label:'只读'},{value:'EDITOR',label:'编辑'},{value:'MANAGER',label:'管理'},{value:'DENY',label:'禁止访问'}]} onChange={role=>share({...sharing,policy:{...sharing.policy,grants:sharing.policy.grants.map(x=>x===g?{...x,role,canCreate:['EDITOR','MANAGER'].includes(role)}:x)}})}/><Button disabled={g.principalType==='USER'&&g.principalId===sharing.ownerId} onClick={()=>share({...sharing,policy:{...sharing.policy,grants:sharing.policy.grants.filter(x=>x!==g)}})}>移除</Button></Space>)}
    </Drawer>
  </section>;
}
