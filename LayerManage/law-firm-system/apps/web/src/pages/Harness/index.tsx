import { useState } from 'react';
import { Alert, Button, Card, InputNumber, Space, Typography} from 'antd';
import Modal from '@/components/DraggableModal';
import { connectHarness, type HarnessConnection, type HarnessFeature } from '@/api/harness';

export default function HarnessPage({ feature }: { feature: HarnessFeature }) {
  const [port,setPort]=useState(43123),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connection,setConnection]=useState<HarnessConnection>();
  const knowledge=feature==='knowledge';
  const localPage=['localhost','127.0.0.1'].includes(location.hostname)&&location.protocol==='http:';
  const connect=async()=>{setBusy(true);setError('');try{setConnection(await connectHarness(feature,port));}catch(e){setError(e instanceof Error?e.message:'连接失败，请重试');}finally{setBusy(false);}};
  const stop=()=>Modal.confirm({title:'停止本机助手？',content:'这会关闭当前账户的知识库和办案会话。请先保存正在编辑的内容，本机文件会保留。',okText:'停止助手',cancelText:'取消',onOk:async()=>{try{await connectHarness(feature,port,true);setConnection(undefined);}catch(e){setError(e instanceof Error?e.message:'停止失败');}}});
  return <div>
    <h2>{knowledge?'个人知识库':'智慧办案'}</h2>
    <p>{knowledge?'管理个人资料、原文、编译 Wiki 与来源引用，复用 Harness 原生知识库。':'使用法律助手阅卷、核对证据和起草文书，结合自己的本机知识库开展工作。'}</p>
    <Space wrap style={{marginBottom:16}}>
      <label htmlFor="harness-port">本机连接器端口</label><InputNumber id="harness-port" aria-label="本机连接器端口" min={1024} max={65535} precision={0} value={port} disabled={busy||!!connection} onChange={v=>setPort(v||43123)} />
      <Button type="primary" loading={busy} onClick={()=>void connect()}>{connection?'重新连接':'连接本机助手'}</Button>
      {connection&&<><Button href={connection.url} target="_blank" rel="noopener noreferrer">在新窗口打开</Button><Button danger onClick={stop}>停止本机助手</Button></>}
    </Space>
    {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}} />}
    {connection ? <>
      <Alert type="success" showIcon title={'已连接个人助手 · Harness '+connection.version} description={<Typography.Text copyable>{'本机数据目录：'+connection.dataDirectory}</Typography.Text>} style={{marginBottom:12}} />
      {localPage?<iframe key={connection.url} src={connection.url} title={knowledge?'Harness 个人知识库':'Harness 智慧办案'} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups" style={{width:'100%',height:'calc(100vh - 310px)',minHeight:580,border:'1px solid #e5e7eb',borderRadius:8}} />:<Alert type="info" title="请点击“在新窗口打开”使用本机助手" description="远程 OA 页面使用独立窗口连接个人电脑上的知识库，避免浏览器跨站嵌入限制。" />}
    </> : <Card title="首次使用">
      <ol><li>在自己的电脑上配置并运行 ChengyeOA 本机连接器。</li><li>点击“连接本机助手”，系统将建立当前 OA 账户专属的本地目录。</li><li>在助手设置中填写个人模型配置；在知识库中导入案卷，在新会话中使用“智慧办案法律助手”。</li></ol>
      <Typography.Paragraph>本机启动命令（项目 integrations/harness 目录）：</Typography.Paragraph>
      <Typography.Paragraph code copyable>node connector.mjs config.local.json</Typography.Paragraph>
      <p>将 config.example.json 复制为 config.local.json，按实际安装位置填写 Harness 路径及 OA 地址。首次使用需要 Node.js 22.19+ 或 24+ 和 pnpm。</p>
      <Alert type="info" showIcon title="个人知识库保存在自己的电脑上" description="原始资料、提取文本、编译 Wiki、会话和个人模型设置位于本机账户目录。请自行备份；OA 不会自动发送案件资料。扫描件 OCR 需在个人 Profile 中另行配置。" />
    </Card>}
  </div>;
}
