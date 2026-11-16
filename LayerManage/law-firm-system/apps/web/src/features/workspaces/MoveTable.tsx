import { useMenuLabels } from '@/features/navigation/menu-labels';
import {useState} from 'react';
import {Alert,Button,Select,message} from 'antd';
import Modal from '@/components/DraggableModal';
import {get,post,errorMessage} from './api';
import {businessSources,isBusinessSource} from '../crm/business-sources';
import {useNavigate} from 'react-router';
export default function MoveTable({tableId,disabled}:{tableId:string;disabled?:boolean}){
  const { sourcePath } = useMenuLabels();
  const navigate=useNavigate();const [open,setOpen]=useState(false),[targets,setTargets]=useState<{id:string;name:string;workspaceName:string;moduleSource?:string|null}[]>([]),[target,setTarget]=useState<string>(),[preview,setPreview]=useState<{previewToken:string;fields:number;records:number;views:number;rules:number}>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <><Button disabled={disabled} onClick={async()=>{setOpen(true);setTarget(undefined);setPreview(undefined);setError('');try{setTargets(await get<typeof targets>('/tables/'+tableId+'/move-targets'));}catch(e){setError(errorMessage(e));}}}>移动工作表</Button>
    <Modal title="移动工作表" open={open} onCancel={()=>setOpen(false)} confirmLoading={busy} okText={preview?'确认移动':'预览移动'} okButtonProps={{disabled:!target}} onOk={async()=>{if(!target)return;setBusy(true);setError('');try{
      if(!preview)setPreview(await post<typeof preview>('/tables/'+tableId+'/move-preview',{targetBaseId:target}));
      else{const moved=await post<{baseId:string;moduleSource:string}>('/tables/'+tableId+'/move',{targetBaseId:target,previewToken:preview.previewToken});setOpen(false);message.success('工作表已移动');navigate((isBusinessSource(moved.moduleSource)?businessSources[moved.moduleSource].path:'/workspaces')+'?'+new URLSearchParams({base:moved.baseId,table:tableId}));}
    }catch(e){setError(errorMessage(e));setPreview(undefined);}finally{setBusy(false);}}}>
      <p>原记录、字段、视图、角色行列权限和自动化保留。原权限边界与目标目录权限取交集，目标目录未授权的成员将无法访问。</p>
      <Select aria-label="目标目录" showSearch={{optionFilterProp:'label'}} style={{width:'100%'}} value={target} options={targets.map(t=>({value:t.id,label:sourcePath(t.moduleSource,t.workspaceName+' / '+t.name)}))} onChange={v=>{setTarget(v);setPreview(undefined);}}/>
      {preview&&<Alert type="info" title={`将保留 ${preview.fields} 个字段、${preview.records} 条表内记录、${preview.views} 个视图及 ${preview.rules} 个自动化规则。关联业务记录继续使用原数据。`}/>}
      {error&&<Alert type="error" title={error}/>}
    </Modal></>;
}
