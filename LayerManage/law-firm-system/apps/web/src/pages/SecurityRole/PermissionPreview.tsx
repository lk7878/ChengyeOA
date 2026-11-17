import { createPortal } from 'react-dom';
import CurrentPagePreview from './CurrentPagePreview';
import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Empty, Select, Space, Table, Tag, Watermark } from 'antd';
import { useLocation } from 'react-router';
import PermissionOverview, { type OverviewSubject } from './PermissionOverview';
import { get, post, errorMessage } from '@/features/workspaces/api';
import type { Field, RecordRow } from '@/features/workspaces/types';
import { domainCreate } from '@/features/crm/business-sources';
import { displayValue } from '@/features/workspaces/display-value';
import { allTables,allSubjects,presetNames,previewEvent,tableOptions,type TableOption } from './worksheet-permission-options';

type Choice={label:string;value:string};
type Preview={fields:Field[];records:RecordRow[];total:number;canEdit:boolean;canDelete:boolean;canAdd:boolean;source:string;actions:string[]};
export default function PermissionPreview({name}:{name:string}) {
  const {search,pathname}=useLocation();
  const [open,setOpen]=useState(false),[drawer,setDrawer]=useState(false);
  const [table,setTable]=useState<string>(),[subject,setSubject]=useState<string>();
  const [tables,setTables]=useState<TableOption[]>([]),[choices,setChoices]=useState<Choice[]>([]);
  const [page,setPage]=useState(1);
  const [result,setResult]=useState<{key:string;data?:Preview;error?:string}>();
  const [loadError,setLoadError]=useState('');
  useEffect(()=>{const handler=(evt:Event)=>{const {table,id,target}=(evt as CustomEvent).detail;
    setTable(table);setSubject(target+':'+id);setPage(1);setOpen(true);setDrawer(false)};
    window.addEventListener(previewEvent,handler);return()=>window.removeEventListener(previewEvent,handler);
  },[]);
  useEffect(()=>{if(!open)return;let live=true;
    get<{tables:TableOption[];subjects:OverviewSubject[]}>('/permission-overview/options').then(({tables:t,subjects})=>{if(!live)return;
        setLoadError('');setTables(t);setChoices([...allSubjects,...Object.entries(presetNames).map(([id,label])=>({value:'PRESET:'+id,label})),
          ...subjects.map(s=>({value:s.target+':'+s.id,label:(s.target==='ROLE'?'角色 · ':'成员 · ')+s.label}))]);
      }).catch(e=>{if(live)setLoadError(errorMessage(e))});return()=>{live=false};
  },[open]);
  const aggregate=table===allTables || !!subject?.startsWith('ALL');
  const presetAggregate=aggregate && !!subject?.startsWith('PRESET:');
  const key=JSON.stringify([subject,table,page,search]);
  useEffect(()=>{if(!open||!table||!subject||aggregate)return;let live=true;
    const [target,id]=subject.split(':');const params=new URLSearchParams(search);
    post<Preview>('/tables/'+table+'/permission-preview',{target,id,page,viewId:params.get('table')===table?params.get('view')??undefined:undefined})
      .then(data=>{if(live)setResult({key,data})}).catch(e=>{if(live)setResult({key,error:errorMessage(e)})});
    return()=>{live=false};
  },[key,open,subject,table,page,search,aggregate]);
  const data=result?.key===key?result.data:undefined;
  return <><Button onClick={()=>{setResult(undefined);setTable(new URLSearchParams(search).get('table')||allTables);setOpen(true);setDrawer(true);setPage(1)}}>权限预览</Button>
    {open&&createPortal(<section aria-label="权限预览" style={{position:'fixed',inset:0,zIndex:1050,background:'var(--ant-color-bg-container, white)',overflow:'auto',color:'#20252c'}}>
      <Watermark content={'预览者 '+name}><div style={{minHeight:'100vh',padding:'0 24px 24px'}}>
        <Space wrap style={{position:'sticky',top:0,zIndex:1,background:'white',padding:'14px 0',width:'100%'}}>
          <strong>当前预览对象</strong><Tag>{choices.find(c=>c.value===subject)?.label||'待选择'}</Tag>
          <Button onClick={()=>setDrawer(true)}>切换预览对象</Button><Button onClick={()=>{setOpen(false);setDrawer(false);setResult(undefined)}}>退出预览</Button>
        </Space>
        {loadError&&<Alert type="error" title={loadError}/>}
        {table && <h2>{tables.find(t=>t.id===table)?.name}</h2>}
        {result?.key===key && result.error && <Empty description={result.error}><Button onClick={()=>setDrawer(true)}>选择其他预览对象</Button></Empty>}
        {aggregate && subject ? presetAggregate ? <Alert type="info" title="预设等级仅用于单表模拟，请选择具体数据表，或选择实际成员、角色查看授权汇总。"/> :
          <PermissionOverview key={JSON.stringify([table,subject])} table={table} subject={subject} tables={tables}
            onPreview={(table,subject)=>{setTable(table);setSubject(subject);setPage(1)}}/> :
          !table && subject && !subject.startsWith('PRESET:') ? <CurrentPagePreview key={subject} subject={subject}
          name={choices.find(c=>c.value===subject)?.label || subject} path={pathname+search}/> : data ? <><Space>{(data.canAdd || (domainCreate(data.source) && data.actions.includes(domainCreate(data.source)?.permission || '')))&&<Button disabled>新增</Button>}{data.canEdit&&<Button disabled>编辑</Button>}{data.canDelete&&<Button disabled>删除</Button>}</Space>
          <Table size="small" rowKey="id" dataSource={data.records} scroll={{x:'max-content'}}
            pagination={{current:page,pageSize:25,total:data.total,showSizeChanger:false,onChange:setPage}}
            columns={data.fields.map(f=>({title:f.name,key:f.id,render:(_,r:RecordRow)=>r.displayValues?.[f.id]??displayValue(f,r.values[f.id],{users:[],organizations:[],employees:[],teams:[]})}))}/></>
          : !(result?.key===key && result.error)&&<Empty description={table&&subject?'正在读取预览':'请选择数据表和预览对象'}/>}
      </div></Watermark>
      <Drawer open={drawer} zIndex={1060} title="预览设置" onClose={()=>setDrawer(false)}>
        <p>数据表</p><Select aria-label="预览数据表" allowClear placeholder="当前业务页面" style={{width:'100%'}} showSearch optionFilterProp="label" value={table} options={[{value:allTables,label:'全部表格'},...tableOptions(tables)]} onChange={v=>{setTable(v);setPage(1)}}/>
        <p>角色或具体成员</p><Select aria-label="预览对象" style={{width:'100%'}} showSearch optionFilterProp="label" value={subject} options={choices}
          onChange={v=>{setSubject(v);setPage(1);setDrawer(false)}}/>
        <p>选择“全部表格＋具体成员”查看该成员所有授权表格；选择“具体表格＋全部成员和角色”查看该表的授权对象。</p>
        <Button type="primary" disabled={!subject} onClick={()=>setDrawer(false)}>查看预览</Button>
      </Drawer>
    </section>,document.body)}</>;
}
