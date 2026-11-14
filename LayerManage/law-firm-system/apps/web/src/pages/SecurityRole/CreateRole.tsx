import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Select, Space, Steps, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { get, errorMessage } from '@/features/workspaces/api';
import { authorizationAdminApi } from '@/features/authorization/admin-api';
import type { RoleAuthorizationView } from '@/features/authorization/types';
import { ApplicationPermissions, type WorksheetChange } from './ApplicationPermissions';

export default function CreateRole({roles,onCreated,onClose,canAuthorize}:{roles:RoleAuthorizationView[];onCreated:(role:RoleAuthorizationView)=>void;onClose:()=>void;canAuthorize:boolean}) {
  const [step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [name,setName]=useState(''),[description,setDescription]=useState(''),[basic,setBasic]=useState(true);
  const [source,setSource]=useState<string>(),[changes,setChanges]=useState<WorksheetChange[]>([]);
  const [capabilities,setCapabilities]=useState<string[]>([]);
  useEffect(()=>{get<{capabilities:string[]}>('/roles/office-template').then(v=>setCapabilities(v.capabilities)).catch(e=>setError(errorMessage(e)));},[]);
  return <Modal open title="新建角色" width={1000} onCancel={onClose} footer={<Space>
    {step>0&&<Button onClick={()=>setStep(s=>s-1)}>上一步</Button>}
    {step<2?<Button type="primary" disabled={!name.trim()} onClick={()=>setStep(s=>s+1)}>下一步</Button>:
      <Button type="primary" loading={busy} onClick={async()=>{
        setBusy(true);setError('');
        try{const role=await authorizationAdminApi.roles.create({name:name.trim(),description:description.trim()||null,basicOffice:basic,
          copyRoleId:source,worksheets:source?[]:changes});
          message.success('角色及初始授权已创建');onCreated(role);
        }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
      }}>核对并创建</Button>}</Space>}>
    <Steps current={step} items={[{title:'基本信息'},{title:'业务授权'},{title:'核对并创建'}]}/>
    {error&&<Alert type="error" title={error}/>}
    <div style={{marginTop:24}}>
      {step===0&&<Form layout="vertical">
        <Form.Item label="角色名称" required><Input aria-label="角色名称" value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></Form.Item>
        <Form.Item label="说明"><Input.TextArea aria-label="角色说明" rows={3} maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/></Form.Item>
        <p>角色编码将在创建时自动生成。</p>
        <Checkbox checked={basic} onChange={e=>setBasic(e.target.checked)}>基础办公</Checkbox>
        <ul>{capabilities.map(c=><li key={c}>{c}</li>)}</ul>
      </Form>}
      {step===1&&<><Form.Item label="复制已有角色的业务授权"><Select allowClear placeholder="自行配置或仅保留基础办公" disabled={!canAuthorize}
        value={source} onChange={id=>{setSource(id);setChanges([]);}} style={{width:'100%'}}
        options={roles.filter(r=>r.type==='BUSINESS'&&r.status==='ENABLED').map(r=>({value:r.id,label:r.name}))}/></Form.Item>
        {source&&<Alert type="info" title={'授权来源 · '+roles.find(r=>r.id===source)?.name} description="将复制业务操作、数据范围、字段及表格规则。创建后可继续调整，成员需单独添加。"/>}
        {canAuthorize?<ApplicationPermissions key={source||'new'} roleId={source} changes={changes} onChange={setChanges} readOnly={!!source}/>:
          <p>当前可创建基础办公角色。业务授权由角色权限管理员配置。</p>}</>}
      {step===2&&<><h3>{name}</h3><p>{description||'未填写说明'}</p>
        <p>基础办公 · {basic?'已勾选':'未勾选'}</p>{basic&&<ul>{capabilities.map(c=><li key={c}>{c}</li>)}</ul>}
        <p>{source?'复制业务授权来源 · '+roles.find(r=>r.id===source)?.name:changes.length?'配置 '+changes.length+' 张工作表':'仅创建基础办公角色'}</p>
        {changes.length>0&&<ApplicationPermissions changes={changes} onChange={setChanges} readOnly/>}
        <p>创建后可在“成员”中分配此角色。</p></>}
    </div>
  </Modal>;
}
