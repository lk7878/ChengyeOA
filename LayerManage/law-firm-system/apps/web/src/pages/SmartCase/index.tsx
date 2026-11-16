import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Card,Spin} from 'antd';
import {get,post} from '@/features/workspaces/api';
export default function SmartCaseLauncher(){
 const started=useRef(false),[error,setError]=useState(''),[url,setUrl]=useState('');
 useEffect(()=>{if(started.current)return;started.current=true;const query=new URLSearchParams(window.location.search),challenge=query.get('challenge');
  void (async()=>{if(challenge){const result=await post<{url:string}>('/smart-case/launch',{challenge});window.location.replace(result.url);return;}const result=await get<{url:string|null}>('/smart-case/config');if(!result.url)throw Error('智慧办案服务尚未配置');const target=new URL(result.url);if(['127.0.0.1','localhost'].includes(target.hostname)&&!['127.0.0.1','localhost'].includes(window.location.hostname))throw Error('外网智慧办案入口尚未配置，请联系系统管理员');if(query.get('caseId'))target.searchParams.set('caseId',query.get('caseId')!);target.searchParams.set('return',window.location.origin);setUrl(target.href);window.location.assign(target.href);})().catch(e=>setError(e.message||'无法进入智慧办案'));
 },[]);
 return <Card title="智慧办案"><p>使用 OA 身份进入独立工作台，选择材料后开展通用法律或专项任务。工作台在新标签页打开，当前页面保持不动。</p>{error?<Alert type="error" message={error}/>:<Spin tip="正在连接智慧办案…"/>}{url&&<Button type="primary" href={url} target="_blank" rel="noopener noreferrer">打开智慧办案</Button>}</Card>;
}
