import { Input, Select, Space } from 'antd';
import { sealReview } from './seal-review';
export default function SealReviewInput({value,onChange,disabled}:{value:unknown;onChange(value:string):void;disabled?:boolean}) {
  const current=sealReview(value);
  return <Space orientation="vertical" style={{width:'100%'}}>
    <Select aria-label="审核结果" disabled={disabled} value={current.decision} style={{width:'100%'}}
      options={['待审核','同意','驳回'].map(value=>({value,label:value}))}
      onChange={decision=>onChange(JSON.stringify({...current,decision}))}/>
    <Input.TextArea aria-label="审核原因" disabled={disabled} value={current.reason} maxLength={2000}
      placeholder="审核原因（驳回时必填）" autoSize={{minRows:2,maxRows:6}}
      onChange={e=>onChange(JSON.stringify({...current,reason:e.target.value}))}/>
  </Space>;
}
