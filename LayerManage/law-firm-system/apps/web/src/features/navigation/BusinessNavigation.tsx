import { Tree } from 'antd';
import { Link } from 'react-router';
import { defaultMenu, menuTree, useMenuStore } from './menu-store';
import type { DataNode } from 'antd/es/tree';
export default function BusinessNavigation({paths,current,onNavigate}:{paths:string[];current?:string;onNavigate:()=>void}){
  const config=useMenuStore(s=>s.config),nodes=config?.nodes??defaultMenu();
  const convert=(items:ReturnType<typeof menuTree>):DataNode[]=>items.map(n=>({key:n.id,title:n.target?<Link aria-current={current===n.target?'page':undefined} to={n.target} onClick={onNavigate}>{n.label}</Link>:n.label,children:convert(n.children)}));
  return <Tree key={String(config?.version??0)+'-'+paths.join('|')} aria-label="承业协作菜单树" blockNode defaultExpandAll selectable={false} treeData={convert(menuTree(nodes,new Set(paths)))}/>;
}
