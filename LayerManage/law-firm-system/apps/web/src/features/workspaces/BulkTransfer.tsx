import { useState } from 'react';
import { Alert, Button, Input, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { post, errorMessage } from './api';
import type { TableDetail, ViewConfig } from './types';

function parseDelimited(text:string) {
  const delimiter=text.includes('\t')?'\t':',';
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {
      if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;
    } else if(!quoted&&c===delimiter) {row.push(cell);cell='';}
    else if(!quoted&&(c==='\n'||c==='\r')) {
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';
    } else cell+=c;
  }
  if(quoted)throw new Error('存在未闭合的引号，请核对粘贴或导入的内容。');
  row.push(cell);if(row.some(v=>v!==''))rows.push(row);
  return rows;
}
export default function BulkTransfer({detail,config,viewId,onImported,superAdmin}:{detail:TableDetail;config:ViewConfig;viewId?:string;onImported:()=>void;superAdmin:boolean}) {
  const [open,setOpen]=useState(false),[content,setContent]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const canImport=detail.table.source==='CUSTOM'&&!detail.table.lifecycleKind&&detail.access.level>=2&&(superAdmin||detail.access.import===true);
  const canExport=detail.access.copy!==false&&(superAdmin||detail.businessPermissions?.includes('data.bulk_export'));
  return <>
    {canExport&&<Button loading={busy} onClick={async()=>{
      setBusy(true);try {
        const data=await post<{fields:{id:string;name:string}[];records:{values:Record<string,unknown>}[]}>('/tables/'+detail.table.id+'/export',{viewId,config});
        const cell=(value:unknown)=>{let text=typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');
          if(typeof value==='string'&&/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
        const csv='\uFEFF'+[data.fields.map(f=>cell(f.name)).join(','),...data.records.map(r=>data.fields.map(f=>cell(r.values[f.id])).join(','))].join('\r\n');
        const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
        a.href=url;a.download=detail.table.name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }catch(e){message.error(errorMessage(e));}finally{setBusy(false);}
    }}>导出当前筛选</Button>}
    {canImport&&<Button onClick={()=>{setError('');setContent('');setOpen(true);}}>批量导入</Button>}
    <Modal open={open} title="批量导入记录" okText="核对并导入" confirmLoading={busy} width={720} onCancel={()=>setOpen(false)}
      onOk={async()=>{
        setBusy(true);setError('');
        try {
          const [header,...rows]=parseDelimited(content);
          if(!header?.length||!rows.length||rows.length>200)throw new Error('请提供列标题和1至200行记录。');
          if(new Set(header).size!==header.length)throw new Error('列标题重复，请核对。');
          const fields=header.map(name=>{const f=detail.fields.find(f=>f.name===name.trim());if(!f||!f.writable)throw new Error('字段不存在或不可写：'+name);return f;});
          const records=rows.map((row,index)=>{
            if(row.length!==header.length)throw new Error('第'+(index+2)+'行的列数与标题不一致。');
            return Object.fromEntries(row.map((value,i)=>[fields[i].id,
              ['NUMBER','PERCENT'].includes(fields[i].type)&&value!==''?Number(value):
              fields[i].type==='BOOLEAN'?['true','1','是'].includes(value):
              fields[i].type==='DATETIME'&&value&&!fields[i].options?.hrPartialDate?new Date(value).toISOString():
              ['MULTI_SELECT','FILE','RELATION'].includes(fields[i].type)?JSON.parse(value||'[]'):value]));
          });
          await post('/tables/'+detail.table.id+'/import',{schemaVersion:detail.table.schemaVersion,records});
          message.success('已导入'+records.length+'条记录');setOpen(false);onImported();
        }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
      }}>
      <p>粘贴电子表格内容或选择 CSV 文件，首行为字段名称。系统自动生成的编号无需填写。人员及关联字段填写对应记录 ID。</p>
      {error&&<Alert type="error" title={error}/>}
      <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" aria-label="选择导入文件" onChange={async e=>{const file=e.target.files?.[0];if(file)setContent(await file.text());}}/>
      <Input.TextArea aria-label="批量导入内容" rows={10} value={content} onChange={e=>setContent(e.target.value)} style={{marginTop:12}}/>
    </Modal>
  </>;
}
