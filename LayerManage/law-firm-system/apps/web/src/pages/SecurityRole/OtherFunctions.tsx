import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Select, Space, Tabs, message } from 'antd';
import request from '@/api/request';
import { authorizationErrorMessage } from '@/features/authorization/admin-api';
import type { DataScopeOption, PermissionCatalogEntry, RoleAuthorizationView } from '@/features/authorization/types';
type Group = { id:string; name:string; resources:string[]; codes:string[]; selected:string[]; scopeIds:string[];scopeBindings:{resource:string;dataScopeId:string}[];scopeChanged?:boolean };
export default function OtherFunctions({role,catalog,scopes,editable,onSaved}:{role:RoleAuthorizationView;catalog:PermissionCatalogEntry[];scopes:DataScopeOption[];editable:boolean;onSaved:(r:RoleAuthorizationView)=>void}) {
  const [groups,setGroups]=useState<Group[]>([]),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  useEffect(()=>{let active=true;void request.get<{data:{groups:Group[]}}>('/v1/roles/'+role.id+'/other-functions').then(r=>{if(active)setGroups(r.data.groups);}).catch(e=>{if(active)setError(authorizationErrorMessage(e));});return()=>{active=false;};},[role.id,role.version]);
  const update=(id:string,patch:Partial<Group>)=>setGroups(gs=>gs.map(g=>g.id===id?{...g,...patch}:g));
  return <><Alert type="info" title="这里只配置非表格功能；具体业务表仍在“应用与表格权限”中授权。" description="勾选操作会自动补齐查看和入口依赖。删除、状态变更、离职等操作需单独勾选。一个功能组使用相同范围；查看全所、编辑本人应使用两个不同范围的角色组合。"/>
    {error&&<Alert type="error" title={error}/>}
    <Tabs items={groups.map(g=>({key:g.id,label:g.name,children:<><Space wrap>{g.codes.map(code=><Checkbox key={code} disabled={!editable||saving} checked={g.selected.includes(code)} onChange={e=>update(g.id,{selected:e.target.checked?[...g.selected,code]:g.selected.filter(c=>c!==code)})}>{catalog.find(c=>c.code===code)?.name||code}</Checkbox>)}</Space>
    {g.id!=='approval'&&<p>更新本组范围（可选） <Select aria-label={g.name+'范围'} mode="multiple" style={{minWidth:280}} disabled={!editable||saving} placeholder="沿用各资源现有范围" value={g.scopeChanged?g.scopeIds:undefined} onChange={scopeIds=>update(g.id,{scopeIds,scopeChanged:true})} options={scopes.filter(s=>g.resources.every(resource=>s.scopeType==='TEAM'?['employee','professional_team','professional_team_member'].includes(resource):['SELF','SELF_AND_SUBORDINATES'].includes(s.scopeType)?resource!=='organization':['ALL','HQ_SCOPE','ORG','BRANCH','CUSTOM'].includes(s.scopeType))).map(s=>({value:s.id,label:s.name}))}/></p>}
    {g.id!=='approval'&&<p>现有范围：{g.scopeBindings.map(b=>(catalog.find(c=>c.resource===b.resource)?.name?.replace(/^查看/,'')||b.resource)+'：'+(scopes.find(s=>s.id===b.dataScopeId)?.name||b.dataScopeId)).join('；')||'尚未授予'}。{g.scopeChanged?'保存将把本组各资源范围统一为所选范围。':'未选择新范围时保留上述配置。'}</p>}
    <p>{g.id==='approval'?'审批仍受申请人、指定审批人和审批流程约束。':'没有范围则不授予任何记录；本人和部门范围需要关联员工。保存仅修改本功能组，历史字段规则保持不变。'}</p>
    {editable&&<Button loading={saving} type="primary" onClick={async()=>{setSaving(true);try{const r=await request.put<{data:RoleAuthorizationView}>('/v1/roles/'+role.id+'/other-functions',{version:role.version,groupId:g.id,permissionCodes:g.selected,...(g.scopeChanged?{scopeIds:g.scopeIds}:{})});onSaved(r.data);message.success(g.name+'已保存，依赖已自动处理');}catch(e){setError(authorizationErrorMessage(e));}finally{setSaving(false);}}}>保存{g.name}</Button>}</>}))}/></>;
}
