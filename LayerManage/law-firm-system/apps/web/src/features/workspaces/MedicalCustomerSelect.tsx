import { useEffect,useRef,useState } from 'react';
import { Select,message } from 'antd';
import { get,post,errorMessage } from './api';
export default function MedicalCustomerSelect({tableId,value,disabled,onChange,onPreview}:{tableId:string;value:unknown;disabled?:boolean;onChange:(v:unknown)=>void;onPreview?:(v:Record<string,unknown>)=>void}){
  const [query,search]=useState(''),[options,setOptions]=useState<{value:string;label:string}[]>([]),[busy,setBusy]=useState(false);const sequence=useRef(0);
  useEffect(()=>{let alive=true;const timer=setTimeout(()=>{void get<typeof options>('/tables/'+tableId+'/medical-customers?keyword='+encodeURIComponent(query)).then(v=>{if(alive)setOptions(v);}).catch(e=>{if(alive)message.error(errorMessage(e));});},200);return()=>{alive=false;clearTimeout(timer);};},[query,tableId]);
  return <Select aria-label="关联客户" showSearch={{filterOption:false,onSearch:search}} allowClear disabled={disabled} loading={busy}
    value={value?String(value):undefined} options={value&&!options.some(o=>o.value===value)?[{value:String(value),label:'已关联客户'},...options]:options}
    onChange={async next=>{const current=++sequence.current;if(!next){setBusy(false);onChange(null);return;}setBusy(true);try{const values=await post<Record<string,unknown>>('/tables/'+tableId+'/medical-customer',{value:next});if(current===sequence.current){onChange(next);onPreview?.(values);}}catch(e){message.error(errorMessage(e));}finally{if(current===sequence.current)setBusy(false);}}}/>;
}
