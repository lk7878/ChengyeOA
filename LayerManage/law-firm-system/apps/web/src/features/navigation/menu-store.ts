import { create } from 'zustand';
import { get } from '@/features/workspaces/api';
import { areas, entries, type Area } from './catalog';
export type MenuNode={id:string;label:string;parentId:string|null;target:string|null;position:number};
export type MenuConfig={version:number;nodes:MenuNode[]|null;targets:string[]};
export function defaultMenu(area:Area='apps'):MenuNode[]{
  const home=areas.find(item=>item.id===area)!.path;
  const items=entries.filter(e=>e.area===area&&!e.hidden&&!e.retired&&e.path!==home);
  return [...new Set(items.map(e=>e.group))].flatMap((group,i)=>[{id:'group-'+i,label:group,parentId:null,target:null,position:i},
    ...items.filter(e=>e.group===group).map((e,j)=>({id:'entry-'+e.path,label:e.title,parentId:'group-'+i,target:e.path,position:j}))]);
}
export const useMenuStore=create<{config:MenuConfig|null;load:()=>Promise<void>;set:(c:MenuConfig)=>void}>(set=>({config:null,
  load:async()=>{const c=await get<MenuConfig>('/navigation-menu');set({config:c});},set:c=>set({config:c})}));
export function menuTree(nodes:MenuNode[],allowed:Set<string>,parentId:string|null=null):Array<MenuNode&{children:ReturnType<typeof menuTree>}>{
  return nodes.filter(n=>n.parentId===parentId).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)).flatMap(n=>{
    const children=menuTree(nodes,allowed,n.id);
    return n.target?allowed.has(n.target)?[{...n,children}]:[]:children.length?[{...n,children}]:[];
  });
}
