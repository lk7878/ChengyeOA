import {useRef,useState} from 'react'
import type {CaseKind} from '../types'
export type TaskDraft={title:string;caseId:string;inputs:Record<string,number>;knowledge:string[];knowledgeInitialized:boolean;scope:string;folders:{id:string;name:string}[]}
export const emptyDraft=():TaskDraft=>({title:'',caseId:'',inputs:{},knowledge:[],knowledgeInitialized:false,scope:'mine',folders:[]})
export const draftKey=(account:string,kind:string)=>`wb:task-draft:v1:${encodeURIComponent(account)}:${kind}`
export function readDraft(storage:Pick<Storage,'getItem'>,key:string):TaskDraft|null{
 try{
  const raw=JSON.parse(storage.getItem(key)||'null')
  if(!raw||raw.schema!==1||Date.now()-raw.savedAt>7*24*3600_000)return null
  const d=raw.draft
  if(!d||typeof d.title!=='string'||typeof d.caseId!=='string'||!d.inputs||!Array.isArray(d.knowledge))return null
  return {title:d.title.slice(0,1000),caseId:d.caseId,inputs:Object.fromEntries(Object.entries(d.inputs).filter(([id,v])=>id.length<=200&&Number.isSafeInteger(v)&&Number(v)>0).map(([id,v])=>[id,Number(v)])),knowledge:d.knowledge.filter((id:unknown)=>typeof id==='string'),knowledgeInitialized:d.knowledgeInitialized===true,scope:d.scope==='shared'?'shared':'mine',folders:Array.isArray(d.folders)?d.folders.filter((f:{id?:unknown;name?:unknown})=>typeof f?.id==='string'&&typeof f?.name==='string'):[]}
 }catch{return null}
}
export function clearAccountDrafts(account:string){try{const prefix=`wb:task-draft:v1:${encodeURIComponent(account)}:`;for(const key of Object.keys(sessionStorage))if(key.startsWith(prefix))sessionStorage.removeItem(key)}catch{/* Storage may be disabled. */}}
export function useTaskDraft(account:string,kind:CaseKind){
 const key=draftKey(account,kind)
 const [draft,setDraft]=useState<TaskDraft>(()=>{try{const saved=readDraft(sessionStorage,key)||emptyDraft();const linkedCase=new URLSearchParams(location.search).get('caseId');return linkedCase?{...saved,caseId:linkedCase}:saved}catch{return emptyDraft()}})
 const [storageError,setStorageError]=useState('')
 const current=useRef(draft)
 const update=(change:Partial<TaskDraft>|((d:TaskDraft)=>TaskDraft))=>{
  const next=typeof change==='function'?change(current.current):{...current.current,...change}
  current.current=next;setDraft(next)
  try{sessionStorage.setItem(key,JSON.stringify({schema:1,savedAt:Date.now(),draft:next}));setStorageError('')}catch{setStorageError('浏览器未允许保存草稿，离开或刷新前请先创建任务。')}
 }
 const clear=()=>{try{sessionStorage.removeItem(key)}catch{/* ignored */}current.current={...emptyDraft(),knowledgeInitialized:true};setDraft(current.current)}
 return {draft,update,clear,storageError}
}
