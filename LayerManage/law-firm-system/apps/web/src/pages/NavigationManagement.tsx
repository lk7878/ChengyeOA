import type { DataNode } from 'antd/es/tree';
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Tree, message } from 'antd';
import request from '@/api/request';
import { errorMessage } from '@/features/workspaces/api';
import { defaultMenu, useMenuStore, type MenuNode } from '@/features/navigation/menu-store';
import { entries } from '@/features/navigation/catalog';
import { useAuthStore } from '@/stores/authStore';
export default function NavigationManagement(){
  const {config,load,set}=useMenuStore();const root=useAuthStore(s=>s.authorization?.isSystemSuperAdmin);
  const [draft,setNodes]=useState<MenuNode[]>(),[selected,select]=useState<string>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{void load().catch(e=>setError(errorMessage(e)));},[load]);
  const nodes=draft??config?.nodes??defaultMenu();
  const node=nodes.find(n=>n.id===selected);
  const change=(patch:Partial<MenuNode>)=>setNodes(nodes.map(n=>n.id===selected?{...n,...patch}:n));
  const tree=(parentId:string|null=null):DataNode[]=>nodes.filter(n=>n.parentId===parentId).sort((a,b)=>a.position-b.position).map(n=>({key:n.id,title:n.label,children:tree(n.id)}));
  const descendants=(id:string):string[]=>[id,...nodes.filter(n=>n.parentId===id).flatMap(n=>descendants(n.id))];
  if(!root)return <Alert type="error" title="仅超级管理员可以管理菜单。"/>;
  return <div className="unified-area-page"><h1>菜单管理</h1><p>调整承业协作菜单的名称、分组和顺序。入口绑定已有页面；移除菜单不会删除业务数据或角色权限。</p>
    {error&&<Alert type="error" title={error}/>}
    <Space><Button disabled={!config||busy} onClick={()=>{const n={id:crypto.randomUUID(),label:'新分组',target:null,parentId:node&&!node.target?node.id:null,position:nodes.length};setNodes([...nodes,n]);select(n.id);}}>新增节点</Button>
      <Button type="primary" loading={busy} disabled={!config} onClick={async()=>{setBusy(true);setError('');try{const c=await request.put<{data:NonNullable<typeof config>}>('/v1/navigation-menu',{version:config!.version,nodes},{suppressGlobalError:true});set(c.data);setNodes(undefined);message.success('菜单已保存');}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>保存菜单</Button></Space>
    <div style={{display:'grid',gridTemplateColumns:'300px minmax(0,1fr)',gap:24,marginTop:20}}><Tree key={String(config?.version)+'-'+nodes.length} defaultExpandAll treeData={tree()} selectedKeys={selected?[selected]:[]} onSelect={keys=>select(String(keys[0]??''))}/>
      {node&&<Form layout="vertical"><Form.Item label="展示名称"><Input aria-label="展示名称" maxLength={50} value={node.label} onChange={e=>change({label:e.target.value})}/></Form.Item>
        <Form.Item label="上级分组"><Select value={node.parentId??''} options={[{value:'',label:'顶层'},...nodes.filter(n=>!n.target&&!descendants(node.id).includes(n.id)).map(n=>({value:n.id,label:n.label}))]} onChange={parentId=>change({parentId:parentId||null})}/></Form.Item>
        <Form.Item label="绑定页面"><Select value={node.target??''} disabled={nodes.some(n=>n.parentId===node.id)} options={[{value:'',label:'仅分组'},...(config?.targets??[]).map(path=>({value:path,label:entries.find(e=>e.path===path)?.title??path}))]} onChange={target=>change({target:target||null})}/></Form.Item>
        <Form.Item label="排序"><Input type="number" min={0} max={1000} value={node.position} onChange={e=>change({position:Number(e.target.value)})}/></Form.Item>
        <Button danger onClick={()=>{const ids=descendants(node.id);setNodes(nodes.filter(n=>!ids.includes(n.id)));select(undefined);}}>移除该节点及子菜单（保存后生效）</Button>
      </Form>}
    </div></div>;
}
