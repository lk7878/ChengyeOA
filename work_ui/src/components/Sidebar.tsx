import clsx from 'clsx'
import type {ViewId} from '@/types'
import {BrandMark} from './BrandMark'
import './Sidebar.css'
export interface SidebarProps{current:ViewId;onNavigate:(v:ViewId)=>void;onOpenExternal:(id:'ai_assistant'|'knowledge_base')=>void;showAccounts?:boolean;showSharing?:boolean}
export function Sidebar({current,onNavigate}:SidebarProps){return <aside className="wb-sidebar"><div className="wb-sidebar__brand"><BrandMark/><div><div className="wb-sidebar__title">承业智慧办案</div><div className="wb-sidebar__subtitle">专业 · 协同 · 可追溯</div></div></div><nav className="wb-sidebar__nav" aria-label="主要栏目">{([{id:'dashboard',label:'概览'},{id:'specialized',label:'专项能力'},{id:'knowledge',label:'知识库'},{id:'cases_general',label:'AI助手'}] as {id:ViewId;label:string}[]).map(i=><button key={i.id} className={clsx('wb-sidebar__item',current===i.id&&'wb-sidebar__item--active')} onClick={()=>onNavigate(i.id)}>{i.label}</button>)}</nav><div className="wb-sidebar__footer"><button className="wb-sidebar__item" onClick={()=>onNavigate('settings')}>设置</button><p>承业 · 智慧办案</p></div></aside>}
