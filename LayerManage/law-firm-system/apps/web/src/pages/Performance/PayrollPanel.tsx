import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Select, Space, Spin, Tag, Upload, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { Link } from 'react-router';
import Table from '@/components/ResizableTable';
import { integrationApi, type PayrollBatch } from '@/api/business-integration';
import { approvalApi, type ApprovalDefinitionView } from '@/api/approval';
import { approvalMaterialsApi, decodeAttachment, downloadBlob, type ApprovalAttachment } from '@/api/approval-materials';
import { useAuthStore } from '@/stores/authStore';
const OfficeEditor = lazy(() => import('../approvals/materials/OfficeEditor'));
const labels: Record<string, string> = { PENDING: '审批中', APPROVED: '已通过 / 待发放', REJECTED: '已驳回', WITHDRAWN: '已撤回' };

export default function PayrollPanel() {
  const canCreate = useAuthStore(s => s.hasPermission('performance.create') && s.hasPermission('approval.apply'));
  const canUpdate = useAuthStore(s => s.hasPermission('performance.update') && s.hasPermission('approval.apply'));
  const [rows, setRows] = useState<PayrollBatch[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [open, setOpen] = useState(false), [file, setFile] = useState<ApprovalAttachment>();
  const [editing, setEditing] = useState<{ row: PayrollBatch; bytes: ArrayBuffer }>(), [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState<PayrollBatch>(), [definitions, setDefinitions] = useState<ApprovalDefinitionView[]>([]), [code, setCode] = useState<string>();
  const [approvalForm] = Form.useForm<Record<string, unknown>>();
  const [form] = Form.useForm<{ title: string; period: string }>();
  const load = useCallback(async () => { setLoading(true); try { const res = await integrationApi.payroll(page); setRows(res.data.list); setTotal(res.data.total); setError(''); } catch { setError('工资表加载失败，请重试'); } finally { setLoading(false); } }, [page]);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const download = async (row: PayrollBatch) => { try { const res = await approvalMaterialsApi.download(row.attachmentId); downloadBlob(new Blob([decodeAttachment(res.data.base64)], { type: res.data.mimeType }), res.data.fileName); } catch { message.error('文件下载失败'); } };
  const preview = async (row: PayrollBatch) => { setBusy(true); try { const res = await approvalMaterialsApi.download(row.attachmentId, 'PREVIEW'); setEditing({ row, bytes: decodeAttachment(res.data.base64).buffer }); setDirty(false); } catch { message.error('文件加载失败'); } finally { setBusy(false); } };
  const saveEdited = async (next: File, exportCopy?: boolean) => {
    if (!editing || !canUpdate || editing.row.instance) return;
    setBusy(true);
    try {
      const attachment = (await approvalMaterialsApi.upload(next, editing.row.attachmentId)).data;
      const row = (await integrationApi.savePayroll({ title: editing.row.title, period: editing.row.period, attachmentId: attachment.id, version: editing.row.version }, editing.row.id)).data;
      setEditing({ ...editing, row }); setDirty(false); await load();
      if (exportCopy) downloadBlob(next, next.name);
      message.success('修改版已保存');
    } finally { setBusy(false); }
  };
  const closeEditor = () => { if (busy) return; if (dirty) Modal.confirm({ title: '尚有未保存的修改，确认放弃？', okText: '放弃修改', onOk: () => { setEditing(undefined); setDirty(false); } }); else setEditing(undefined); };
  return <section>
    <Alert showIcon type="info" title="工资表支持 XLSX 上传、在线编辑、保存和下载。已提交审批的版本保留不变，可复制为新草稿重新申请。" description="文件仅上传者及对应审批参与人可读取。Excel 公式单元格只读，修改数值后请在 Excel 中重新计算公式；审批通过只记为待发放。" style={{ marginBottom: 16 }} />
    <Space style={{ marginBottom: 16 }}><Button onClick={() => void load()}>刷新工资表</Button>{canCreate && <Button type="primary" onClick={() => { form.resetFields(); setFile(undefined); setOpen(true); }}>导入工资表</Button>}<Link to="/approvals">前往审批管理</Link></Space>
    {error && <Alert type="error" title={error} />}
    <Table<PayrollBatch> locale={{ emptyText: '暂无工资表' }} rowKey="id" dataSource={rows} loading={loading} pagination={{ current: page, total, pageSize: 20, showSizeChanger: false, onChange: setPage }} columns={[
      { title: '工资表名称', dataIndex: 'title', width: 210 }, { title: '工资月份', dataIndex: 'period', width: 110 },
      { title: '当前文件', key: 'file', width: 240, render: (_, r) => r.attachment.fileName },
      { title: '审批状态', key: 'status', width: 150, render: (_, r) => <Tag>{r.instance ? labels[r.instance.status] || r.instance.status : '草稿'}</Tag> },
      { title: '操作', key: 'actions', width: 350, render: (_, r) => <Space wrap>
        <Button type="link" disabled={busy} onClick={() => void preview(r)}>{r.instance || !canUpdate ? '预览' : '预览 / 编辑'}</Button><Button type="link" onClick={() => void download(r)}>下载</Button>
        {!r.instance && canUpdate && <Button type="link" disabled={busy} onClick={async () => { setBusy(true); try { setDefinitions((await approvalApi.definitions()).data.filter(d => d.businessType === 'PAYROLL')); setCode(undefined); approvalForm.resetFields(); setSubmitting(r); } catch { message.error('审批流程加载失败'); } finally { setBusy(false); } }}>发起审批</Button>}
        {canCreate && <Button type="link" disabled={busy} onClick={async () => { setBusy(true); try { const next = (await approvalMaterialsApi.clone(r.attachmentId)).data; await integrationApi.savePayroll({ title: r.title + '（副本）', period: r.period, attachmentId: next.id }); await load(); } catch { message.error('复制未完成'); } finally { setBusy(false); } }}>复制草稿</Button>}
      </Space> },
    ]} />
    <Modal okText="确定" cancelText="取消" title="导入工资表" open={open} confirmLoading={busy} onOk={() => form.submit()} onCancel={() => { if (!busy) setOpen(false); }} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={async values => { if (!file) { message.error('请上传 XLSX 工资表'); return; } setBusy(true); try { await integrationApi.savePayroll({ ...values, attachmentId: file.id }); setOpen(false); await load(); message.success('工资表草稿已保存'); } catch { message.error('保存未完成，输入已保留'); } finally { setBusy(false); } }}>
        <Form.Item label="工资表名称" name="title" rules={[{ required: true, whitespace: true, message: '请输入工资表名称' }]}><Input aria-label="工资表名称" maxLength={200} /></Form.Item>
        <Form.Item label="工资月份" name="period" rules={[{ required: true, pattern: /^\d{4}-(0[1-9]|1[0-2])$/, message: '请输入 YYYY-MM，如 2026-09' }]}><Input aria-label="工资月份" placeholder="2026-09" /></Form.Item>
        <Upload accept=".xlsx" maxCount={1} showUploadList={false} disabled={busy} beforeUpload={async selected => { if (!/\.xlsx$/i.test(selected.name) || selected.size > 10 * 1024 * 1024) { message.error('请上传不超过 10 MB 的 XLSX 文件；XLS 请先另存为 XLSX'); return false; } setBusy(true); try { setFile((await approvalMaterialsApi.upload(selected)).data); } catch { message.error('上传失败，请重试'); } finally { setBusy(false); } return false; }}><Button loading={busy}>选择 Excel 工资表</Button></Upload>
        <p>{file?.fileName || '尚未上传文件'}</p>
      </Form>
    </Modal>
    <Modal okText="确定" cancelText="取消" title={editing?.row.title} open={!!editing} onCancel={closeEditor} footer={null} width="95vw" destroyOnHidden maskClosable={false}>
      {editing && <Suspense fallback={<Spin />}><OfficeEditor bytes={editing.bytes} fileName={editing.row.attachment.fileName} readOnly={!!editing.row.instance || !canUpdate} onDirty={setDirty} onSave={saveEdited} /></Suspense>}
    </Modal>
    <Modal okText="确定" cancelText="取消" title="发起工资审批" open={!!submitting} confirmLoading={busy} okButtonProps={{ disabled: !code || busy }} onCancel={() => { if (!busy) setSubmitting(undefined); }} onOk={async () => {
      if (!submitting || !code) return; setBusy(true);
      try { const extra = await approvalForm.validateFields(); await approvalApi.apply({ definitionCode: code, title: submitting.title, content: { ...extra, period: submitting.period }, attachmentIds: [submitting.attachmentId], payrollBatchId: submitting.id, payrollVersion: submitting.version, idempotencyKey: 'payroll-' + submitting.id + '-' + submitting.version }); setSubmitting(undefined); await load(); message.success('已提交，审批管理中可查看'); } catch { message.error('审批未提交，请检查流程配置及必填信息'); } finally { setBusy(false); }
    }}>
      <p>提交当前已保存文件：{submitting?.attachment.fileName}</p>
      {definitions.length === 0 && <Alert type="warning" title="暂无可用工资流程，请管理员在审批管理 → 流程定义管理中创建“工资发放”类型，并设置审批人。" />}
      <Select aria-label="工资审批流程" style={{ width: '100%' }} placeholder="选择工资审批流程" value={code} onChange={value => { setCode(value); approvalForm.resetFields(); }} options={definitions.map(d => ({ value: d.code, label: d.name }))} />
      <Form form={approvalForm} layout="vertical" style={{ marginTop: 16 }}>
        {((definitions.find(d => d.code === code)?.formSchema as { fields?: Array<{ key: string; label: string; type: string; required?: boolean }> } | undefined)?.fields || []).filter(f => f.key !== 'period').map(f => <Form.Item key={f.key} name={f.key} label={f.label} rules={f.required ? [{ required: true, message: '请填写' + f.label }] : []}>{f.type === 'number' ? <InputNumber style={{ width: '100%' }} /> : f.type === 'textarea' ? <Input.TextArea /> : <Input type={f.type === 'date' ? 'date' : 'text'} />}</Form.Item>)}
      </Form>
    </Modal>
  </section>;
}
