import { useState } from 'react';
import { Alert, Button, List, Select, Space, Spin, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router';
import Modal from '@/components/DraggableModal';
import { get, post, errorMessage } from './api';
interface Detail {
  caseNo: string; title: string; version: number; canSubmit: boolean;
  needsNumber: boolean; numberingOptions: {value:string;label:string}[]; sealReviewers: {id:string;label:string}[];
  reviewers: { id: string; label: string }[];
  history: { id: string; status: string; createdAt: string; workflowInstanceId: string | null }[];
}
const labels: Record<string, string> = { PENDING: '待审批', APPROVED: '已通过', REJECTED: '已退回', WITHDRAWN: '已撤回' };
export default function CaseRegistration({ tableId, caseId, disabled, onChanged }: {
  tableId: string; caseId: string; disabled?: boolean; onChanged(): void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail>(), [reviewer, setReviewer] = useState<string>();
  const [numberCode,setNumberCode] = useState<string>();
  const [sealReviewer,setSealReviewer] = useState<string>();
  const [error, setError] = useState('');
  const url = `/tables/${tableId}/records/${caseId}/case-registration`;
  async function load() {
    setBusy(true); setError(''); setDetail(undefined); setReviewer(undefined);
    try {
      const data = await get<Detail>(url);
      setDetail(data); setNumberCode(undefined); setSealReviewer(data.sealReviewers.length === 1 ? data.sealReviewers[0].id : undefined);
      if (data.reviewers.length === 1) setReviewer(data.reviewers[0].id);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function submit() {
    if (!detail || !reviewer || !sealReviewer || (detail.needsNumber && !numberCode)) return;
    setBusy(true); setError('');
    try {
      const result = await post<{ workflowInstanceId: string }>(url, { version: detail.version, reviewerId: reviewer, sealReviewerId: sealReviewer, ...(detail.needsNumber ? { numberCode } : {}) });
      onChanged(); setOpen(false);
      navigate(`/approvals?instance=${result.workflowInstanceId}`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <>
    <Button size="small" disabled={disabled} onClick={() => { setOpen(true); void load(); }}>登记审批</Button>
    <Modal title="案件登记审批" open={open} onCancel={() => !busy && setOpen(false)} footer={<Space>
      <Button disabled={busy} onClick={() => setOpen(false)}>关闭</Button>
      <Button type="primary" loading={busy} disabled={!detail?.canSubmit || !reviewer || !sealReviewer || (detail.needsNumber && !numberCode)} onClick={() => void submit()}>确认提交案件管理员</Button>
    </Space>}>
      {error && <Alert type="error" showIcon title={error} />}
      <Spin spinning={busy}>
        {detail && <>
          <Typography.Paragraph strong>{detail.caseNo} · {detail.title}</Typography.Paragraph>
          {detail.canSubmit ? <>
            <Typography.Paragraph>提交当前已保存的登记信息，案件管理员审批通过后自动受理、分配合同编号并转交印章管理员。审批期间不能修改，退回或撤回后可修改并重新提交。</Typography.Paragraph>
            <label htmlFor={`case-reviewer-${caseId}`}>案件管理员</label>
            <Select id={`case-reviewer-${caseId}`} aria-label="案件管理员" style={{ width: '100%' }} value={reviewer} onChange={setReviewer} options={detail.reviewers.map(u => ({ value: u.id, label: u.label }))} placeholder="选择案件管理员" />
            {detail.needsNumber && <><label>合同编号类别</label><Select aria-label="合同编号类别" style={{width:'100%'}} value={numberCode} onChange={setNumberCode} options={detail.numberingOptions} placeholder="选择合同编号类别" /></>}
            <label>印章管理员</label><Select aria-label="印章管理员" style={{width:'100%'}} showSearch optionFilterProp="label" value={sealReviewer} onChange={setSealReviewer} options={detail.sealReviewers.map(u=>({value:u.id,label:u.label}))} placeholder="选择核对编号及盖章的人员" />
            {!detail.sealReviewers.length && <Alert type="warning" title="暂无印章管理员，请联系超级管理员授予案件合同编号核对与盖章权限。" />}
            {!detail.reviewers.length && <Alert type="warning" title="暂无可用案件管理员，请联系超级管理员配置。" />}
          </> : <Typography.Paragraph type="secondary">当前案件已提交审批、已受理，或你没有登记提交权限。可查看已有审批记录。</Typography.Paragraph>}
          <List dataSource={detail.history} locale={{ emptyText: '暂无登记审批记录' }} renderItem={item => <List.Item actions={item.workflowInstanceId ? [<Button key="open" type="link" onClick={() => navigate(`/approvals?instance=${item.workflowInstanceId}`)}>查看审批</Button>] : []}>
            <Space><Tag>{labels[item.status] || item.status}</Tag><span>{new Date(item.createdAt).toLocaleString()}</span></Space>
          </List.Item>} />
        </>}
      </Spin>
    </Modal>
  </>;
}
