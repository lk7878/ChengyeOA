import { useState } from 'react';
import { Alert, Button, Checkbox, Select, Space, message } from 'antd';
import Modal from '@/components/DraggableModal';
import request from '@/api/request';
import { get, post, errorMessage } from '@/features/workspaces/api';
import type { RoleAuthorizationView } from '@/features/authorization/types';
type Template={version:number;permissionCodes:string[];capabilities:string[]};
const names:Record<string,string>={'approval.read':'查看本人相关审批','approval.apply':'发起向本人开放的申请','approval.process':'处理分配给本人的审批任务','menu.security_my_access':'本人权限页面','permission.trace.self':'查询本人权限来源'};
export default function OfficeTemplate({roles,onSaved}:{roles:RoleAuthorizationView[];onSaved:()=>void}) {
  const [template,setTemplate]=useState<Template>(),[open,setOpen]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<string[]>([]),[diff,setDiff]=useState<{name:string;added:string[];removed:string[]}[]>();
  const targets=selected.map(id=>({id,version:roles.find(r=>r.id===id)!.version}));
  return <><Button onClick={async()=>{try{setTemplate(await get<Template>('/roles/office-template'));setOpen(true);setDiff(undefined);setError('');}catch(e){message.error(errorMessage(e));}}}>基础办公模板</Button>
    <Modal title="基础办公默认模板" open={open} onCancel={()=>setOpen(false)} footer={null} width={700}>
      {error&&<Alert type="error" title={error}/>}
      {template&&<>
        <ul>{template.capabilities.map(c=><li key={c}>{c}</li>)}</ul>
        <Space wrap>{Object.entries(names).map(([code,name])=><Checkbox key={code} checked={template.permissionCodes.includes(code)}
          onChange={e=>{setTemplate({...template,permissionCodes:e.target.checked?[...template.permissionCodes,code]:template.permissionCodes.filter(c=>c!==code)});setDiff(undefined);}}>{name}</Checkbox>)}</Space>
        <p><Button onClick={async()=>{try{const r=await request.put<{data:Template}>('/roles/office-template',{version:template.version,permissionCodes:template.permissionCodes});
          setTemplate(r.data);setDiff(undefined);message.success('模板已保存，新建角色将使用此版本');}catch(e){setError(errorMessage(e));}}}>保存新建角色默认模板</Button></p>
        <h3>显式更新已有角色</h3>
        <Select mode="multiple" style={{width:'100%'}} aria-label="选择应用模板的角色" placeholder="选择要更新的角色" value={selected}
          options={roles.filter(r=>r.type==='BUSINESS').map(r=>({value:r.id,label:r.name}))} onChange={ids=>{setSelected(ids);setDiff(undefined);}}/>
        <Space style={{marginTop:12}}><Button disabled={!selected.length} onClick={async()=>{try{setDiff(await post('/roles/office-template/apply',{roles:targets,templateVersion:template.version,apply:false}));}catch(e){setError(errorMessage(e));}}}>预览授权差异</Button>
          <Button type="primary" disabled={!diff} onClick={async()=>{try{await post('/roles/office-template/apply',{roles:targets,templateVersion:template.version,apply:true});setDiff(undefined);onSaved();message.success('所选角色已更新');}catch(e){setError(errorMessage(e));}}}>确认应用已预览的差异</Button></Space>
        {diff&&<ul>{diff.map(d=><li key={d.name}>{d.name} · 增加 {d.added.join('、')||'无'} · 移除 {d.removed.join('、')||'无'}</li>)}</ul>}
      </>}
    </Modal></>;
}
