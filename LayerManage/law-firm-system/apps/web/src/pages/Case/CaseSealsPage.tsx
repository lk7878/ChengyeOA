import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, List, Space, Table, Tag, Typography, Upload, message } from 'antd';
import type { UploadFile } from 'antd';
import { useSearchParams } from 'react-router';
import Modal from '@/components/DraggableModal';
import { get, post, errorMessage } from '@/features/workspaces/api';
interface Item { id:string; status:string; case:{caseNo:string;title:string}; contract:{contractNo:string} }
interface Detail {
  id:string;version:number;status:string;contractNo:string;
  snapshot:{caseNo:string;title:string;registration:{registration:string};files:{id:string;fileName:string}[]};
  stampedFiles:{id:string;fileName:string}[];
  changes:{action:string;oldValues:string|null;newValues:string|null;createdAt:string}[];
}
export default function CaseSealsPage() {
  const [params,setParams]=useSearchParams();
  const [items,setItems]=useState<Item[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[keyword,setKeyword]=useState(''),[filter,setFilter]=useState('');
  const [detail,setDetail]=useState<Detail>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [files,setFiles]=useState<UploadFile[]>([]),[correction,setCorrection]=useState(false);
  const [form]=Form.useForm();
  const id=params.get('request');
  async function load() {
    setError('');
    try { const data=await get<{items:Item[];total:number}>(`/case-seals?page=${page}&keyword=${encodeURIComponent(filter)}`);setItems(data.items);setTotal(data.total); }
    catch(e){setError(errorMessage(e));}
  }
  async function open(requestId:string) {
    setBusy(true);setError('');
    try {setDetail(await get<Detail>('/case-seals/'+requestId));setFiles([]);setCorrection(false);form.resetFields();}
    catch(e){setDetail(undefined);setError(errorMessage(e));}finally{setBusy(false);}
  }
  useEffect(()=>{
    let active=true;
    void get<{items:Item[];total:number}>(`/case-seals?page=${page}&keyword=${encodeURIComponent(filter)}`).then(data=>{
      if(active){setItems(data.items);setTotal(data.total);setError('');}
    }).catch(e=>{if(active)setError(errorMessage(e));});
    return()=>{active=false;};
  },[page,filter]);
  useEffect(()=>{
    if(!id)return;
    let active=true;
    void get<Detail>('/case-seals/'+id).then(data=>{
      if(active){setDetail(data);setFiles([]);setCorrection(false);form.resetFields();setError('');}
    }).catch(e=>{if(active){setDetail(undefined);setError(errorMessage(e));}});
    return()=>{active=false;};
  },[id,form]);
  async function download(file:{id:string;fileName:string}) {
    if(!detail)return;
    try {
      const data=await get<{base64:string;fileType:string;fileName:string}>(`/case-seals/${detail.id}/files/${file.id}`);
      const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:data.fileType}));const a=document.createElement('a');a.href=url;a.download=data.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(errorMessage(e));}
  }
  async function correct() {
    if(!detail)return;
    const input=await form.validateFields();setBusy(true);setError('');
    try {await post(`/case-seals/${detail.id}/number`,{version:detail.version,...input});await open(detail.id);await load();message.success('合同编号已更正');}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  async function stamp() {
    if(!detail||!files.length)return;
    setBusy(true);setError('');
    try {
      const attachments=await Promise.all(files.map(f=>new Promise<{fileName:string;fileType:string;category:string;base64:string}>((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve({fileName:f.name,fileType:f.type||'application/octet-stream',category:'合同附件',base64:String(reader.result).split(',')[1]});reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(f.originFileObj!);
      })));
      await post(`/case-seals/${detail.id}/stamp`,{version:detail.version,attachments});await open(detail.id);await load();message.success('已确认盖章并保存合同');
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <main className="unified-area-page">
    <h1>合同核对与盖章</h1>
    <Space wrap><Input.Search aria-label="搜索盖章待办" placeholder="案件编号、名称或合同编号" value={keyword} onChange={e=>setKeyword(e.target.value)} onSearch={()=>{setPage(1);if(filter!==keyword)setFilter(keyword);else void load();}}/><Button onClick={()=>void load()}>刷新</Button></Space>
    {error&&(!detail||detail.id!==id)&&<Alert type="error" title={error}/>}
    <Table rowKey="id" dataSource={items} pagination={{current:page,total,pageSize:20,onChange:setPage}} columns={[
      {title:'案件',render:(_,r:Item)=><>{r.case.caseNo}<br/>{r.case.title}</>},
      {title:'合同编号',render:(_,r:Item)=>r.contract.contractNo},
      {title:'状态',render:(_,r:Item)=><Tag color={r.status==='STAMPED'?'green':'blue'}>{r.status==='STAMPED'?'已盖章':'待核对盖章'}</Tag>},
      {title:'操作',render:(_,r:Item)=><Button onClick={()=>setParams({request:r.id})}>查看并办理</Button>},
    ]}/>
    <Modal width={800} open={!!detail&&detail.id===id} title="合同核对与盖章" onCancel={()=>!busy&&setParams({})} footer={<Space><Button disabled={busy} onClick={()=>setParams({})}>关闭</Button>{detail?.status==='PENDING'&&<Button type="primary" loading={busy} disabled={!files.length||correction} onClick={()=>void stamp()}>确认已盖章并保存合同</Button>}</Space>}>
      {error&&<Alert type="error" title={error}/>}
      {detail&&<>
        <Typography.Title level={4}>{detail.snapshot.caseNo} · {detail.snapshot.title}</Typography.Title>
        <Typography.Paragraph strong>合同编号：{detail.contractNo}</Typography.Paragraph>
        {detail.status==='PENDING'&&<Button disabled={busy} onClick={()=>{setCorrection(!correction);form.setFieldsValue({number:detail.contractNo,reason:''});}}>更正合同编号</Button>}
        {correction&&<Form form={form} layout="vertical" onFinish={()=>void correct()}>
          <Form.Item name="number" label="正确合同编号" rules={[{required:true}]}><Input/></Form.Item>
          <Form.Item name="reason" label="更正原因" rules={[{required:true,whitespace:true}]}><Input maxLength={500}/></Form.Item>
          <Button htmlType="submit" loading={busy}>保存编号更正</Button>
        </Form>}
        <Typography.Title level={5}>审核通过的登记信息</Typography.Title>
        <div style={{maxHeight:300,overflowY:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{detail.snapshot.registration.registration}</div>
        <List header="原合同与案件材料" dataSource={detail.snapshot.files} locale={{emptyText:'未上传材料'}} renderItem={f=><List.Item><Button type="link" onClick={()=>void download(f)}>{f.fileName}</Button></List.Item>}/>
        {detail.status==='PENDING'?<>
          <Typography.Paragraph>完成线下盖章后，上传盖章合同并确认。所有文件合计不超过 10 MB。</Typography.Paragraph>
          <Upload beforeUpload={()=>false} multiple fileList={files} onChange={({fileList})=>setFiles(fileList)} disabled={busy} accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"><Button>上传盖章合同</Button></Upload>
        </>:<List header="已盖章合同" dataSource={detail.stampedFiles} renderItem={f=><List.Item><Button type="link" onClick={()=>void download(f)}>{f.fileName}</Button></List.Item>}/>}
        {detail.changes.length>0&&<details><summary>办理记录</summary>{detail.changes.map((c,i)=><p key={i}>{new Date(c.createdAt).toLocaleString()} · {c.action==='CASE_CONTRACT_STAMPED'?'已确认盖章':'编号更正'}<br/>{c.action==='CASE_CONTRACT_NUMBER_CORRECT'&&`${JSON.parse(c.oldValues||'{}').number} → ${JSON.parse(c.newValues||'{}').number}；${JSON.parse(c.newValues||'{}').reason}`}</p>)}</details>}
      </>}
    </Modal>
  </main>;
}
