import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Form, Menu, Radio, Select, Space, Table, message } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import FilterEditor from '@/features/workspaces/FilterEditor';
import { errorMessage, get, post } from '@/features/workspaces/api';
import type { Field, Filter, Option } from '@/features/workspaces/types';

export const presetNames: Record<string,string> = {OWNER:'所有者',MANAGER:'管理员',EDITOR:'编辑者',READER:'阅读者'};
export type TableOption = {id:string;name:string;base:{id:string;name:string;workspace:{name:string}}};
type Mode = 'EDIT'|'READ'|'MASK'|'HIDDEN';
type Rule = { level:string;rows:'ALL'|'SELF'|'FILTER';filter?: Filter;viewIds?:string[];fields:Record<string,Mode>;
  add:boolean;remove:boolean;analytics:boolean;copy:boolean;automate:boolean };
type Settings = {version:number;views:Option[];fields:Field[];rules:Record<string,Rule>};
const levels = [{value:'MANAGER',label:'可管理'},{value:'EDITOR',label:'可编辑'},{value:'READER',label:'仅可阅读'},{value:'DENY',label:'无权限'}];
const modes = [{value:'EDIT',label:'可编辑'},{value:'READ',label:'仅读'},{value:'MASK',label:'脱敏'},{value:'HIDDEN',label:'隐藏'}];
const actions = {add:'新增记录',remove:'删除记录',analytics:'仪表盘',copy:'复制与导出',automate:'审批自动化'};
export const tableOptions = (tables:TableOption[]) => tables.map(t=>({value:t.id,label:[t.base.workspace.name,t.base.name,t.name].join(' / ')}));
export const previewEvent = 'oa:worksheet-permission-preview';
export function WorksheetPermissions({roles,superAdmin}:{roles:Option[];superAdmin:boolean}) {
  const [open,setOpen]=useState(false);
  const [tables,setTables]=useState<TableOption[]>([]);
  const [role,setRole]=useState('READER');
  const [table,setTable]=useState<string>();
  const [error,setError]=useState('');
  useEffect(()=>{if(!open)return; let active=true;
    get<TableOption[]>('/worksheet-permissions/tables').then(items=>{if(active){setTables(items);setTable(t=>t ?? items[0]?.id)}})
      .catch(e=>{if(active)setError(errorMessage(e))}); return ()=>{active=false};
  },[open]);
  return <><Button onClick={()=>setOpen(true)}>工作表权限</Button>
    <Drawer open={open} onClose={()=>setOpen(false)} title="工作表权限" size="large" destroyOnHidden>
      <div style={{display:'grid',gridTemplateColumns:'minmax(110px, 28%) minmax(0,1fr)',gap:16}}>
        <Menu selectedKeys={[role]} onClick={e=>setRole(e.key)} items={[
          ...Object.entries(presetNames).map(([key,label])=>({key,label})),...roles.map(r=>({key:r.id,label:r.name}))]}/>
        <section>{error && <Alert type="error" title={error}/>}
          <Form.Item label="数据表"><Select showSearch optionFilterProp="label" value={table} options={tableOptions(tables)} onChange={setTable}/></Form.Item>
          {role==='OWNER' ? <Alert type="info" title="所有者由工作区归属确定，拥有完整的协作控制权。"/> : table &&
            <RuleEditor key={role+table} role={role} table={table} superAdmin={superAdmin} onPreview={()=>{
              setOpen(false); window.dispatchEvent(new CustomEvent(previewEvent,{detail:{table,id:role,target:role in presetNames?'PRESET':'ROLE'}}));
            }}/>}
        </section>
      </div>
    </Drawer></>;
}
function RuleEditor({role,table,superAdmin,onPreview}:{role:string;table:string;superAdmin:boolean;onPreview():void}) {
  const [settings,setSettings]=useState<Settings>();
  const [rule,setRule]=useState<Rule>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;
    get<Settings>('/worksheet-permissions/'+table).then(s=>{if(!active)return;
      setSettings(s);const level=role in presetNames?role:'DENY',edit=['EDITOR','MANAGER'].includes(level);
      setRule(s.rules[role] ?? {level,rows:'ALL',fields:{},add:edit,remove:edit,copy:true,analytics:true,automate:edit});
    }).catch(e=>{if(active)setError(errorMessage(e))});return()=>{active=false};
  },[table,role]);
  const change=(patch:Partial<Rule>)=>setRule(r=>r && {...r,...patch});
  const writable=rule?.level==='EDITOR'||rule?.level==='MANAGER';
  const save=async(preview:boolean)=>{if(!settings||!rule)return;setBusy(true);setError('');
    try {const r=await post<{version:number}>('/worksheet-permissions/'+table,{roleId:role,version:settings.version,rule});
      setSettings({...settings,version:r.version});message.success('工作表权限已保存');if(preview)onPreview();
    }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
  };
  return <>{error&&<Alert type="error" title={error}/>}
    {settings&&rule&&<Form layout="vertical" disabled={busy}>
      <Form.Item label="表级权限"><Radio.Group options={levels} value={rule.level} onChange={e=>change({level:e.target.value})}/></Form.Item>
      <Form.Item label="记录范围"><Select value={rule.rows} disabled={rule.level==='DENY'} onChange={rows=>change({rows})} options={[
        {value:'ALL',label:'全部授权记录'},{value:'SELF',label:'仅本人创建'},{value:'FILTER',label:'满足以下条件'}]}/></Form.Item>
      {rule.rows==='FILTER'&&<FilterEditor fields={settings.fields} value={rule.filter} onChange={filter=>change({filter})}/>}
      <Form.Item label="可见视图">
        <Checkbox checked={!rule.viewIds} onChange={e=>change({viewIds:e.target.checked?undefined:settings.views.map(v=>v.id)})}>全部可用视图</Checkbox>
        {rule.viewIds && <Select mode="multiple" aria-label="选择共享视图" value={rule.viewIds} options={settings.views.map(v=>({value:v.id,label:v.name}))}
          onChange={viewIds=>change({viewIds})}/>}
      </Form.Item>
      <Form.Item label="操作权限"><Space wrap>{(Object.keys(actions) as (keyof typeof actions)[]).map(k=>{
        const disabled=rule.level==='DENY'||(!writable&&['add','remove','automate'].includes(k));
        return <Checkbox key={k} disabled={disabled} checked={!disabled&&rule[k]} onChange={e=>change({[k]:e.target.checked})}>{actions[k]}</Checkbox>;
      })}</Space></Form.Item>
      <Space style={{marginBottom:8}}><strong>字段权限</strong><Button size="small" disabled={rule.level==='DENY' || !Object.keys(rule.fields).length}
        onClick={()=>change({fields:{}})}>{writable?'重置为全部可编辑':'重置为全部仅读'}</Button></Space>
      <Table size="small" rowKey="id" pagination={false} dataSource={settings.fields} columns={[
        {title:'字段',dataIndex:'name'},{title:'字段权限',render:(_,f:Field)=><Select aria-label={f.name+'权限'} disabled={rule.level==='DENY'}
          value={!writable && (rule.fields[f.id]??'EDIT')==='EDIT'?'READ':rule.fields[f.id]??'EDIT'}
          options={modes.map(m=>({...m,disabled:m.value==='EDIT'&&!writable}))}
          onChange={v=>change({fields:{...rule.fields,[f.id]:v}})}/>}]} />
      <Space style={{marginTop:16}}><Button loading={busy} type="primary" onClick={()=>void save(false)}>保存权限</Button>
        {superAdmin&&<Button loading={busy} onClick={()=>void save(true)}>保存并预览</Button>}</Space>
    </Form>}</>;
}
