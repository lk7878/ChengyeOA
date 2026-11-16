import { useLayoutEffect,useState } from 'react';
import { Alert } from 'antd';
import { runtimeSession } from '@/features/auth/runtime-session';
import '@/features/authorization/preview-frame';

export default function CurrentPagePreview({subject,name,path}:{subject:string;name:string;path:string}) {
  return <PreviewFrame key={JSON.stringify([subject,name])} subject={subject} name={name} path={path}/>;
}
function PreviewFrame({subject,name,path}:{subject:string;name:string;path:string}) {
  const [frame]=useState(()=>'oa-permission-preview:'+crypto.randomUUID());
  useLayoutEffect(()=>{
    const [kind,id]=subject.split(':');
    const token=frame;
    const registry=window.oaPreviewFrames ??=new Map();
    registry.set(token,{id:kind==='ROLE'?'preview:'+id:id,name,async read(method:string,path:string,body:unknown){
      if(!registry.has(token)||!path.startsWith('/')||!['GET','POST'].includes(method))return {status:403,data:{}};
      const url=new URL('/api/v1/permission-preview/read'+path,window.location.origin);
      if(!url.pathname.startsWith('/api/v1/permission-preview/read/') || url.origin!==window.location.origin)return {status:403,data:{}};
      const res=await fetch(url,{method,redirect:'error',credentials:'omit',headers:{
        Authorization:'Bearer '+runtimeSession.getAccessToken(),'Content-Type':'application/json','x-oa-preview-kind':kind,'x-oa-preview-id':id
      },...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
      return {status:res.status,data:await res.json()};
    }});
    return()=>{registry.delete(token)};
  },[subject,name,frame]);
  if (/^\/(?:smart-case|login|security\/account)(?:\/|$)/.test(path))
    return <Alert type="info" title="此页面包含个人凭据或外部应用，请选择工作表预览数据权限。" />;
  return frame ? <iframe inert title="当前页面权限预览" name={frame} key={frame+path} src={path}
    style={{border:0,width:'100%',height:'calc(100vh - 82px)',pointerEvents:'none'}}/>:null;
}
