import clsx from 'clsx'
import {viewToKind,type ViewId} from '@/types'
import {BrandMark} from './BrandMark'
import './Sidebar.css'
export interface SidebarProps{current:ViewId;onNavigate:(v:ViewId)=>void;onOpenExternal:(id:'ai_assistant'|'knowledge_base')=>void;showAccounts?:boolean;showSharing?:boolean;showSettings?:boolean}
export function Sidebar({current,onNavigate,showSettings}:SidebarProps){
  const activeView=viewToKind(current)?'cases_general':current
  const links: {id:ViewId;label:string}[]=[
    {id:'dashboard',label:'概览'},
    {id:'knowledge',label:'知识库'},
    {id:'cases_general',label:'AI助手'},
  ]
  return <aside className="wb-sidebar">
    <div className="wb-sidebar__brand"><BrandMark/><div><div className="wb-sidebar__title">承业智慧办案</div><div className="wb-sidebar__subtitle">专业 · 协同 · 可追溯</div></div></div>
    <nav className="wb-sidebar__nav" aria-label="主要栏目">
      {links.map(({id,label})=><button key={id} className={clsx('wb-sidebar__item',activeView===id&&'wb-sidebar__item--active')}
        aria-current={activeView===id?'page':undefined} onClick={()=>onNavigate(id)}>{label}</button>)}
    </nav>
    <div className="wb-sidebar__footer">{showSettings&&<button className="wb-sidebar__item" onClick={()=>onNavigate('settings')}>AI 与授权管理</button>}<p>承业 · 智慧办案</p></div>
  </aside>
}
