import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Collapse, Form, Menu, Select, Space, Table, Tag } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import FilterEditor from '@/features/workspaces/FilterEditor';
import { errorMessage, get } from '@/features/workspaces/api';
import type { Field, Filter } from '@/features/workspaces/types';
import { previewEvent } from './WorksheetPermissions';

export type TableRule = {level:string;rows:'ALL'|'SELF'|'FILTER';filter?:Filter;fields:Record<string,string>;viewIds?:string[];
  add:boolean;remove:boolean;copy:boolean;analytics:boolean;automate:boolean;share?:boolean;import?:boolean;
  business?:{permissions:string[];scopeIds:string[]}};
export type WorksheetChange = {tableId:string;version:number;rule:TableRule};
type CatalogTable = {id:string;name:string;source:string;inventoryKind?:string;base:{id:string;name:string;workspace:{name:string;moduleGroup?:string}}};
type Settings = {inherited?:{roleId:string;source:string;level:string}[];version:number;rules:Record<string,TableRule>;fields:Field[];views:{id:string;name:string}[];
  capabilities:{permissionNames?:Record<string,string>;scopeTypes?:string[];selfMeaning?:string;resource:string|null;basic:string[];edit:string[];scoped:boolean;special:{code:string;name:string}[]}};
type Scope = {id:string;name:string;scopeType:string};
const levels=[{value:'DENY',label:'无权限'},{value:'READER',label:'查看'},{value:'EDITOR',label:'编辑'},{value:'MANAGER',label:'管理'}];
const fieldModes=[{value:'HIDDEN',label:'隐藏'},{value:'MASK',label:'脱敏查看'},{value:'READ',label:'完整查看'},{value:'EDIT',label:'编辑'}];
const emptyRule=():TableRule=>({level:'DENY',rows:'ALL',fields:{},add:false,remove:false,copy:false,analytics:true,automate:false,share:false,import:false});
export function ApplicationPermissions({roleId,changes,onChange,readOnly=false,superAdmin=false}:
  {roleId?:string;changes:WorksheetChange[];onChange:(value:WorksheetChange[])=>void;readOnly?:boolean;superAdmin?:boolean}) {
  const [tables,setTables]=useState<CatalogTable[]>([]);
  const [settings,setSettings]=useState<Record<string,Settings>>({});
  const [scopes,setScopes]=useState<Scope[]>([]);
  const [group,setGroup]=useState<string>();
  const [selected,setSelected]=useState<React.Key[]>([]);
  const [editing,setEditing]=useState<string>();
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;
    Promise.all([get<CatalogTable[]>('/worksheet-permissions/tables'),get<Scope[]>('/permissions/data-scopes')])
      .then(async([items,range])=>{
        if(!active)return;
        setTables(items);setScopes([{id:'worksheet:self',name:'本人相关',scopeType:'SELF'},{id:'worksheet:department',name:'本部门',scopeType:'OWN_ORG'},...range]);
        const loaded=await Promise.all(items.map(async t=>[t.id,await get<Settings>('/worksheet-permissions/'+t.id)] as const));
        if(active)setSettings(Object.fromEntries(loaded));
      }).catch(e=>{if(active)setError(errorMessage(e));});
    return()=>{active=false;};
  },[roleId]);
  const groups=useMemo(()=>[...new Set(tables.map(t=>t.base.workspace.moduleGroup || t.base.workspace.name))],[tables]);
  const currentGroup=group || groups[0];
  const visible=tables.filter(t=>(t.base.workspace.moduleGroup || t.base.workspace.name)===currentGroup);
  const ruleFor=(id:string)=>changes.find(c=>c.tableId===id)?.rule || settings[id]?.rules[roleId || ''] || emptyRule();
  const change=(ids:string[],patch:Partial<TableRule>)=>{
    const next=[...changes];
    for(const id of ids) {
      const config=settings[id];if(!config)continue;
      const old=ruleFor(id),level=patch.level ?? old.level,writable=['EDITOR','MANAGER'].includes(level);
      const rule={...old,...patch};
      if(patch.level!==undefined) {rule.add=writable; if(!writable){rule.remove=false;rule.import=false;rule.automate=false;}if(level!=='MANAGER')rule.share=false;}
      // Preserve advanced legacy rules until the administrator explicitly edits this table.
      if(!old.business && old.level==='DENY') rule.fields={...Object.fromEntries(config.fields.filter(f=>f.options?.hrSensitive || ['phone','wechat','intake.customerPhone'].includes(String(f.options?.businessKey))).map(f=>[f.id,'MASK'])),...rule.fields};
      if(!old.business) rule.business={permissions:[],scopeIds:config.capabilities.scoped?['worksheet:self']:[]};
      const business=patch.business ?? rule.business!;
      rule.business={...business,permissions:[...new Set([
        ...config.capabilities.basic,...(writable?config.capabilities.edit:[]),
        ...business.permissions.filter(code=>!config.capabilities.basic.includes(code)&&!config.capabilities.edit.includes(code)),
      ])]};
      if(level==='DENY')rule.business.permissions=[];
      const value={tableId:id,version:config.version,rule};
      const at=next.findIndex(c=>c.tableId===id);if(at<0)next.push(value);else next[at]=value;
    }
    onChange(next);
  };
  const t=tables.find(t=>t.id===editing),s=editing?settings[editing]:undefined,r=editing?ruleFor(editing):undefined;
  const scopeLabel=(id:string)=>{const rule=ruleFor(id);if(rule.rows==='FILTER')return '自定义条件（高级）';if(rule.rows==='SELF')return '本人创建';
    if(!rule.business)return '沿用现有业务数据范围';
    if(!settings[id]?.capabilities.scoped)return '全部授权记录';
    return rule.business.scopeIds.map(id=>id==='ALL'?'全公司':scopes.find(s=>s.id===id)?.name || id).join('、') || '未授权记录';};
  return <>
    {error&&<Alert type="error" title={error}/>}
    <p>查看包含浏览、筛选和个人视图。编辑增加录入及修改授权记录。管理增加字段、共享视图和表设置维护。</p>
    <Alert type="info" title="成员按多个角色和直接分享合并获得权限。本角色设为无权限，仅撤销本角色这一来源的授权。"/>
    <div style={{display:'grid',gridTemplateColumns:'150px minmax(0,1fr)',gap:16,marginTop:16}}>
      <Menu selectedKeys={currentGroup?[currentGroup]:[]} onClick={e=>{setGroup(e.key);setSelected([]);}}
        items={groups.map(g=>({key:g,label:tables.find(t=>(t.base.workspace.moduleGroup||t.base.workspace.name)===g)?.base.workspace.name||g}))}/>
      <section>
        {!readOnly&&<Space style={{marginBottom:12}}>批量设置
          <Select aria-label="批量权限等级" placeholder="选择权限等级" disabled={!selected.length} style={{width:150}}
            options={levels} onChange={level=>change(selected.map(String),{level})}/></Space>}
        <Table rowKey="id" size="small" dataSource={visible} pagination={{pageSize:10}}
          rowSelection={readOnly?undefined:{selectedRowKeys:selected,onChange:setSelected}}
          columns={[
            {title:'表名',render:(_,t)=><>{t.name}{settings[t.id]?.inherited?.filter(g=>g.roleId===roleId).map(g=><div key={g.source}><small>{g.source} · {levels.find(l=>l.value===g.level)?.label||g.level}</small></div>)}</>},
            {title:'权限等级',render:(_,t)=><Select aria-label={t.name+'权限'} style={{width:100}} options={levels}
              disabled={readOnly||!settings[t.id]} value={ruleFor(t.id).level} onChange={level=>change([t.id],{level})}/>},
            {title:'数据范围',render:(_,t)=>scopeLabel(t.id)},
            {title:'特殊权限',render:(_,t)=>{const r=ruleFor(t.id);return r.business?<Tag>{r.remove||r.copy||r.share||r.business.permissions.some(c=>settings[t.id]?.capabilities.special.some(s=>s.code===c))?'已配置':'默认关闭'}</Tag>:<Tag>沿用原配置</Tag>;}},
            {title:'操作',render:(_,t)=><Button size="small" disabled={!settings[t.id]} onClick={()=>setEditing(t.id)}>设置</Button>},
          ]}/>
      </section>
    </div>
    <Drawer title={t?.name+' · 表格权限'} open={!!editing} width={640} onClose={()=>setEditing(undefined)}>
      {t&&s&&r&&<Form layout="vertical" disabled={readOnly}>
        {!r.business && <Alert type="warning" title="该表使用原有权限规则。未修改的表不会被本次保存覆盖；修改前请核对高级设置。"/>}
        <p>本表将自动补齐 {([...s.capabilities.basic,...(['EDITOR','MANAGER'].includes(r.level)?s.capabilities.edit:[])].map(code=>s.capabilities.permissionNames?.[code]||code).join('、'))||'基础协作能力'}。</p>
        <Form.Item label="数据范围">
          {s.capabilities.scoped?<Select mode="multiple" value={r.business?.scopeIds || []} aria-label="业务数据范围"
            options={[{value:'ALL',label:'全公司'},...scopes.filter(x=>(s.capabilities.scopeTypes||['SELF','ORG','BRANCH']).includes(x.scopeType)).map(x=>({value:x.id,label:x.id==='worksheet:self'?s.capabilities.selfMeaning||x.name:x.name}))]}
            onChange={scopeIds=>change([t.id],{business:{permissions:r.business?.permissions||[],scopeIds}})}/>:
            <p>此表使用独立记录。可通过高级条件按“人员”或“组织”关联字段限定范围。文字姓名或部门不能可靠对应登录账号。</p>}
        </Form.Item>
        {s.capabilities.scoped&&<p>“本人相关”表示{s.capabilities.selfMeaning}。角色预览没有具体员工身份，可切换到实际成员预览核对本人和本部门记录。</p>}
        <Form.Item label="协作授权"><Checkbox checked={!!r.share} disabled={r.level!=='MANAGER'||readOnly}
          onChange={e=>change([t.id],{share:e.target.checked})}>允许在本表授权协作（受本人可转授权限限制）</Checkbox></Form.Item>
        <Form.Item label="特殊权限"><Space wrap>
          <Checkbox checked={r.remove} disabled={!['EDITOR','MANAGER'].includes(r.level)||readOnly} onChange={e=>change([t.id],{remove:e.target.checked})}>删除记录</Checkbox>
          {t.source==='CUSTOM'&&<Checkbox checked={!!r.import} disabled={!['EDITOR','MANAGER'].includes(r.level)||readOnly}
            onChange={e=>change([t.id],{import:e.target.checked})}>批量导入</Checkbox>}
          <Checkbox checked={r.copy} onChange={e=>change([t.id],{copy:e.target.checked})}>批量导出</Checkbox>
          {s.capabilities.special.map(item=><Checkbox key={item.code} checked={r.business?.permissions.includes(item.code)??false}
            onChange={e=>change([t.id],{business:{scopeIds:r.business?.scopeIds||[],permissions:e.target.checked?[...(r.business?.permissions||[]),item.code]:(r.business?.permissions||[]).filter(c=>c!==item.code)}})}>{item.name}</Checkbox>)}
        </Space></Form.Item>
        <Table rowKey="id" size="small" dataSource={s.fields} pagination={{pageSize:8}} columns={[
          {title:'字段名称',dataIndex:'name'},
          {title:'字段权限',render:(_,f)=><Select aria-label={f.name+'字段权限'} style={{width:130}} options={fieldModes.map(m=>({...m,disabled:m.value==='EDIT'&&!['EDITOR','MANAGER'].includes(r.level)}))}
            value={r.fields[f.id]||(['EDITOR','MANAGER'].includes(r.level)?'EDIT':'READ')}
            onChange={mode=>change([t.id],{fields:{...r.fields,[f.id]:mode}})}/>},
        ]}/>
        <Collapse style={{marginTop:16}} items={[{key:'advanced',label:'高级设置 · 自定义条件及共享视图',children:<>
          <Form.Item label="记录条件"><Select value={r.rows} options={[{value:'ALL',label:'不追加行条件'},{value:'SELF',label:'本人创建的记录'},{value:'FILTER',label:'自定义条件'}]}
            onChange={rows=>change([t.id],{rows})}/></Form.Item>
          {r.rows==='FILTER'&&<FilterEditor fields={s.fields} value={r.filter} onChange={filter=>change([t.id],{filter})}/>}
          <Checkbox checked={!r.viewIds} onChange={e=>change([t.id],{viewIds:e.target.checked?undefined:s.views.map(v=>v.id)})}>全部可用共享视图</Checkbox>
          {r.viewIds&&<Select mode="multiple" value={r.viewIds} options={s.views.map(v=>({value:v.id,label:v.name}))} onChange={viewIds=>change([t.id],{viewIds})}/>}
        </>}]} />
        {superAdmin&&roleId&&<Button style={{marginTop:16}} disabled={changes.some(c=>c.tableId===t.id)}
          onClick={()=>window.dispatchEvent(new CustomEvent(previewEvent,{detail:{table:t.id,id:roleId,target:'ROLE'}}))}>预览已保存的角色权限</Button>}
      </Form>}
    </Drawer>
    {changes.length>0&&<Alert type="warning" title="待保存授权差异" description={<ul>{changes.map(c=><li key={c.tableId}>
      {tables.find(t=>t.id===c.tableId)?.name} · {levels.find(l=>l.value===settings[c.tableId]?.rules[roleId||'']?.level)?.label||'无权限'}
      → {levels.find(l=>l.value===c.rule.level)?.label} · {scopeLabel(c.tableId)}
      {c.rule.remove?' · 允许删除':''}{c.rule.share?' · 可授权协作':''}{c.rule.import?' · 可批量导入':''}{c.rule.copy?' · 可批量导出':''}
      {c.rule.business?.permissions.filter(code=>settings[c.tableId]?.capabilities.special.some(s=>s.code===code)).map(code=>' · '+(settings[c.tableId]?.capabilities.permissionNames?.[code]||code)).join('')}
      {Object.entries(c.rule.fields).filter(([id,mode])=>mode!==settings[c.tableId]?.rules[roleId||'']?.fields[id]).map(([id,mode])=>' · '+(settings[c.tableId]?.fields.find(f=>f.id===id)?.name||'字段')+' '+(fieldModes.find(m=>m.value===mode)?.label||mode)).join('')}
    </li>)}</ul>}/>}
  </>;
}
