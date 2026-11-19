import {useCallback,useEffect,useSyncExternalStore} from 'react'
import type {ViewId} from './types'
const event='wb:navigation'
function subscribe(cb:()=>void){window.addEventListener('popstate',cb);window.addEventListener(event,cb);return()=>{window.removeEventListener('popstate',cb);window.removeEventListener(event,cb)}}
export function updateLocation(values:Record<string,string|null>,replace=false){
 const url=new URL(window.location.href)
 for(const [key,value] of Object.entries(values)){if(value===null||value==='')url.searchParams.delete(key);else url.searchParams.set(key,value)}
 if(url.href===window.location.href)return
 window.history[replace?'replaceState':'pushState'](null,'',url)
 window.dispatchEvent(new Event(event))
}
export function useLocationParams(){const search=useSyncExternalStore(subscribe,()=>window.location.search);return new URLSearchParams(search)}
export function readView(params:URLSearchParams):ViewId{
 const allowed=['dashboard','knowledge','settings','cases_general','cases_disability','cases_injury','cases_malpractice','cases_traffic']
 const view=params.get('view')
 if(view==='specialized')return 'cases_general'
 return (view&&allowed.includes(view)?view:!view&&params.has('caseId')?'cases_general':'dashboard') as ViewId
}
export function useNavigation(){
 const params=useLocationParams()
 const legacySpecialized=params.get('view')==='specialized'
 useEffect(()=>{
  if(legacySpecialized)updateLocation({view:'cases_general',preset:null},true)
 },[legacySpecialized])
 const setView=useCallback((view:ViewId)=>updateLocation({view}),[])
 return {view:readView(params),setView}
}
