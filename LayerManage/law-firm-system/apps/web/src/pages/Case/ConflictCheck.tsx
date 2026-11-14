import { useEffect, useState } from 'react';
import { Alert, Form, Input } from 'antd';
import request from '@/api/request';
import type { ApiResponse } from '@/types';

export type ConflictResult = { level: 'GREEN' | 'YELLOW' | 'RED'; count: number; sameRegion: number; fingerprint: string };

export default function ConflictCheck({ id, linked }: { id?: string; linked: boolean }) {
  const form = Form.useFormInstance();
  const customerId = Form.useWatch('customerId', form);
  const opponent = Form.useWatch(['intakeData','opposingParty'], form);
  const region = Form.useWatch(['intakeData','region'], form);
  const phone = Form.useWatch(['intakeData','customerPhone'], form);
  const [result, setResult] = useState<ConflictResult>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setResult(undefined);
    setError(false);
    form.setFieldValue('conflictReview', undefined);
    if (!customerId) return;
    const timer = window.setTimeout(() => {
      void request.post<ApiResponse<ConflictResult>>('/v1/cases/conflict-screen', { id, customerId, linked,
        intakeData: { opposingParty: opponent, ...(!linked && { region, customerPhone: phone }) } })
        .then(({data}) => { if (active) {
          setResult(data);
          if (data.count) form.setFieldValue(['conflictReview','fingerprint'], data.fingerprint);
        } }).catch(() => { if (active) setError(true); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [form, customerId, opponent, region, phone, linked, id]);
  if (!customerId) return null;
  return <ConflictResultFields result={result} error={error}/>;
}

export function ConflictResultFields({result,error}:{result?:ConflictResult;error:boolean}) {
  if (!result) return <Alert type={error ? 'error' : 'info'} title={error ? '利益冲突筛查暂未完成，保存时将重新核验' : '正在筛查全所案件…'} />;
  return <>
    <Alert showIcon type={result.count ? (result.level === 'RED' ? 'error' : 'warning') : 'success'}
      title={result.count ? (result.level === 'RED' ? '红色 · 双方身份高度重合' : '黄色 · 当事人姓名交叉匹配') : '绿色 · 未发现对立方姓名匹配'}
      description={result.count ? `共 ${result.count} 件，地区相同 ${result.sameRegion} 件。核实身份和代理关系后，填写排除理由方可保存。` : undefined} />
    {!!result.count && <>
      <Form.Item name={['conflictReview','fingerprint']} hidden><Input /></Form.Item>
      <Form.Item label="人工核验排除理由" name={['conflictReview','reason']} rules={[{ required:true, whitespace:true }]}>
        <Input.TextArea maxLength={500} />
      </Form.Item>
    </>}
  </>;
}
