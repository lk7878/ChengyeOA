import { useAuthStore } from '@/stores/authStore';
import { runtimeSession } from '@/features/auth/runtime-session';
import { authenticatedFetch, get, post } from '../workspaces/api';
export async function uploadFile(file:File, target:{parentId?:string;fileId?:string;version?:number}, progress:(offset:number)=>void){
  const key='oa-upload:'+JSON.stringify([useAuthStore.getState().authorization?.userId,file.name,file.size,file.lastModified,target]);
  let id=localStorage.getItem(key);
  if(!id){const r=await post<{id:string}>('/personal-files/uploads',{name:file.name,size:file.size,...target});id=r.id;localStorage.setItem(key,id);}
  const status=await get<{offset:number;chunkSize:number;resultId?:string}>('/personal-files/uploads/'+id);
  if(!status.resultId)for(let offset=status.offset;offset<file.size;offset+=status.chunkSize){
    const end=Math.min(offset+status.chunkSize,file.size);let done=false;
    for(let retry=0;retry<3&&!done;retry++){
      const form=new FormData();form.append('file',file.slice(offset,end),'chunk.bin');
      try{const response=await fetch('/api/v1/personal-files/uploads/'+id+'/chunk?offset='+offset,{method:'PUT',headers:{Authorization:'Bearer '+runtimeSession.getAccessToken()},body:form});
        if(response.status===401&&retry<2){await runtimeSession.refreshOnce();continue;}
        if(!response.ok){const body=await response.json();throw new Error(body.message||body.code||'上传失败');}done=true;
      }catch(error){if(retry===2)throw error;}
    }progress(end);
  }
  const result=await post<{id:string;version:number}>('/personal-files/uploads/'+id+'/complete',{});localStorage.removeItem(key);return result;
}
export function versionUrl(id:string,version:number,global=false){
  return `/api/v1/${global?'all-personal-files':'personal-files'}/${encodeURIComponent(id)}/versions/${version}/content`;
}
export async function downloadVersion(id:string,version:number,name:string,global=false){
  const response=await fetch(versionUrl(id,version,global),{headers:{Authorization:'Bearer '+runtimeSession.getAccessToken()}});
  if(!response.ok)throw new Error('文件访问被拒绝或版本不存在');
  const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export async function downloadFolder(id:string,name:string){
  const response=await authenticatedFetch('/api/v1/personal-files/'+encodeURIComponent(id)+'/archive');
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||'COLLAB_FORBIDDEN');}
  const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');
  a.href=url;a.download=name+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
