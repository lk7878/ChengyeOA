import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Spin} from 'antd';
import {get,post} from '@/features/workspaces/api';
import {connectSmartCase} from './connect';
export default function SmartCaseLauncher(){
 const started=useRef(false),[error,setError]=useState('');
 useEffect(()=>{if(started.current)return;started.current=true;
  void connectSmartCase({origin:window.location.origin,search:window.location.search,config:get,launch:challenge=>post('/smart-case/launch',{challenge}),fetch:window.fetch.bind(window),replace:url=>window.location.replace(url)}).catch(e=>setError(e.message||'无法进入智慧办案'));
 },[]);
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24}}><section style={{width:'min(100%, 420px)',textAlign:'center'}} aria-label="连接智慧办案"><h1>承业智慧办案</h1>{error?<><Alert type="error" title={error}/><Button style={{marginTop:16}} onClick={()=>window.location.reload()}>重试</Button><Button type="link" href="/">返回 OA</Button></>:<div role="status"><Spin/><p>正在连接智慧办案…</p></div>}</section></main>;
}
