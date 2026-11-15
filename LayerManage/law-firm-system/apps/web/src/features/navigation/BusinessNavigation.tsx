import { Tree } from 'antd';
import { Link } from 'react-router';
import { defaultMenu, menuTree, useMenuStore } from './menu-store';
import { areas } from './catalog';
import type { DataNode } from 'antd/es/tree';
export default function BusinessNavigation({area='apps',paths,current,onNavigate}:{area?:'apps'|'analytics'|'admin';paths:string[];current?:string;onNavigate:()=>void}){
  const config=useMenuStore(s=>s.config);
  const nodes=area==='apps'?(config?.nodes??defaultMenu()):defaultMenu(area);
  const title=areas.find(item=>item.id===area)!.title;
  const version=area==='apps'?(config?.version??0):0;
  const convert=(items:ReturnType<typeof menuTree>):DataNode[]=>items.map(n=>({key:n.id,title:n.target?<Link aria-current={current===n.target?'page':undefined} to={n.target} onClick={onNavigate}>{n.label}</Link>:n.label,children:convert(n.children)}));
  return <Tree key={area+'-'+version+'-'+paths.join('|')} aria-label={title+'菜单树'} blockNode defaultExpandAll selectable={false} treeData={convert(menuTree(nodes,new Set(paths)))}/>;
}
