import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Select, Table, message } from 'antd';
import Modal from '@/components/DraggableModal';
import request from '@/api/request';
import { get, errorMessage } from '@/features/workspaces/api';
import type { RoleAuthorizationView } from '@/features/authorization/types';
type Application={id:string;name:string;canCreate:boolean;defaultLevel:string;version:number};
export default function ApplicationDefaults({role,onSaved,editable}:{role:RoleAuthorizationView;onSaved:(role:RoleAuthorizationView)=>void;editable:boolean}) {
  const [rows,setRows]=useState<Application[]>([]),[pending,setPending]=useState<string[]>([]),[error,setError]=useState('');
  useEffect(()=>{get<Application[]>('/roles/'+role.id+'/applications').then(setRows).catch(e=>setError(errorMessage(e)));setPending([]);},[role.id,role.version]);
  const change=(id:string,patch:Partial<Application>)=>{setRows(r=>r.map(x=>x.id===id?{...x,...patch}:x));setPending(p=>[...new Set([...p,id])]);};
  return <>{error&&<Alert type="error" title={error}/>}
    <p>新表默认单独授权。默认查看或编辑仅适用于普通自定义表，业务表和敏感标准表需单独授权。</p>
    <Table rowKey="id" size="small" pagination={false} dataSource={rows} columns={[
      {title:'应用',dataIndex:'name'},
      {title:'允许在本应用创建表格',render:(_,row)=><Checkbox disabled={!editable} checked={row.canCreate} onChange={e=>change(row.id,{canCreate:e.target.checked})}/>},
      {title:'普通新增表默认授权',render:(_,row)=><Select disabled={!editable} value={row.defaultLevel}
        options={[{value:'DENY',label:'单独授权'},{value:'READER',label:'默认查看'},{value:'EDITOR',label:'默认编辑'}]}
        onChange={defaultLevel=>change(row.id,{defaultLevel})}/>},
    ]}/>
    {editable&&<Button style={{marginTop:12}} disabled={!pending.length} onClick={()=>Modal.confirm({
      title:'确认应用设置变更',content:<ul>{rows.filter(r=>pending.includes(r.id)).map(r=><li key={r.id}>{r.name} · {r.canCreate?'允许创建':'不授予创建'} · {({DENY:'新表单独授权',READER:'普通新表默认查看',EDITOR:'普通新表默认编辑'})[r.defaultLevel]}</li>)}</ul>,
      onOk:async()=>{try{const result=await request.put<{data:RoleAuthorizationView}>('/roles/'+role.id+'/applications',{version:role.version,
        applications:rows.filter(r=>pending.includes(r.id)).map(({id,...rest})=>({workspaceId:id,canCreate:rest.canCreate,defaultLevel:rest.defaultLevel,version:rest.version}))});
        onSaved(result.data);message.success('应用设置已保存');}catch(e){setError(errorMessage(e));throw e;}}
    })}>核对并保存应用设置</Button>}</>;
}
