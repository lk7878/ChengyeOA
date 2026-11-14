import axios, { AxiosError, type AxiosAdapter } from 'axios';

type FrameSession = {
  id:string; name:string;
  read(method:string,path:string,body:unknown):Promise<{status:number;data:unknown}>;
};
declare global { interface Window { oaPreviewFrames?:Map<string,FrameSession> } }
export const inPreviewFrame=typeof window!=='undefined' && window.parent!==window && window.name.startsWith('oa-permission-preview:');
export function frameSession() {
  if (!inPreviewFrame) return;
  try {return window.parent.oaPreviewFrames?.get(window.name);} catch {return;}
}
export const previewAdapter:AxiosAdapter=async config=>{
  const session=frameSession();
  if (!session) throw new AxiosError('预览已结束');
  const url = new URL(axios.getUri(config),window.location.origin);
  if (url.origin!==window.location.origin || !url.pathname.startsWith('/api/v1/')) throw new AxiosError('预览请求无效');
  const {data,status}=await session.read((config.method||'get').toUpperCase(),url.pathname.slice(7)+url.search,config.data);
  const response={data,status,statusText:String(status),headers:{},config};
  if(status>=400)throw new AxiosError('预览请求未通过',undefined,config,undefined,response);
  return response;
};
