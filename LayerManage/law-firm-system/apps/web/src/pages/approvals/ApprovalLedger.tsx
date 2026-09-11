import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Select, Space, Tag, message } from 'antd';
import { useSearchParams } from 'react-router';
import Table from '@/components/ResizableTable';
import { integrationApi, type LedgerRow, type SyncRule } from '@/api/business-integration';
import { useAuthStore } from '@/stores/authStore';
import ApprovalAttachments from './materials/ApprovalAttachments';

const targets: Record<string, string> = { COST: '报销成本', LEAVE: '请假台账', SEAL: '用印台账', CONTRACT_CHANGE: '合同变更台账', TRANSFER: '员工调动台账', PAYROLL: '工资台账', CUSTOM: '自定义业务台账', UNCONFIGURED: '待配置台账' };
const statuses: Record<string, string> = { SYNCED: '已同步', FAILED: '待处理', PENDING_CONFIG: '待配置' };
export default function ApprovalLedger() {
  const [params, setParams] = useSearchParams();
  const target = params.get('target') || undefined;
  const [rows, setRows] = useState<LedgerRow[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [detail, setDetail] = useState<LedgerRow>();
  const [rules, setRules] = useState<SyncRule[]>([]), [configure, setConfigure] = useState(false);
  const manage = useAuthStore(s => s.hasPermission('approval.manage'));
  const load = useCallback(async () => { setBusy(true); setError(''); try { const res = await integrationApi.ledger(page, target); setRows(res.data.list); setTotal(res.data.total); } catch { setError('台账加载失败，请重试'); } finally { setBusy(false); } }, [page, target]);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const retry = async (id: string) => { setBusy(true); try { await integrationApi.retry(id); await load(); message.info('已完成同步检查，请查看最新状态'); } catch { message.error('同步未完成，请重试'); } finally { setBusy(false); } };
  return <div>
    <h2>审批业务台账</h2>
    <Alert type="info" showIcon title="最终审批通过后自动同步；审批通过不代表款项已实际支付。" description="台账保留原申请及材料。缺少必要资料的记录显示待处理，补充完整资料重新申请；管理员可在修复关联或配置后重试。" style={{ marginBottom: 16 }} />
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="管理台账" placeholder="全部台账" value={target} allowClear style={{ width: 200 }} options={Object.entries(targets).map(([value, label]) => ({ value, label }))} onChange={value => { setPage(1); setParams(value ? { target: value } : {}); }} />
      <Button onClick={() => void load()}>刷新</Button>
      {manage && <Button onClick={async () => { try { setRules((await integrationApi.rules()).data); setConfigure(true); } catch { message.error('同步配置加载失败'); } }}>配置自定义审批同步</Button>}
    </Space>
    {error && <Alert type="error" title={error} />}
    <Table<LedgerRow> locale={{ emptyText: '暂无审批业务记录' }} rowKey="id" dataSource={rows} loading={busy} pagination={{ current: page, total, pageSize: 20, onChange: setPage, showSizeChanger: false }} columns={[
      { title: '申请标题', dataIndex: 'title', width: 220 }, { title: '审批类型', dataIndex: 'definitionName', width: 140 },
      { title: '管理台账', key: 'target', width: 140, render: (_, r) => targets[r.sync?.target || ''] || '待补同步' },
      { title: '同步状态', key: 'status', width: 110, render: (_, r) => <Tag color={r.sync?.status === 'SYNCED' ? 'green' : 'orange'}>{statuses[r.sync?.status || ''] || '待补同步'}</Tag> },
      { title: '处理说明', key: 'reason', width: 270, render: (_, r) => r.sync?.reason || '—' },
      { title: '通过时间', dataIndex: 'decidedAt', width: 180, render: value => new Date(value).toLocaleString('zh-CN') },
      { title: '操作', key: 'actions', width: 180, render: (_, r) => <Space><Button type="link" onClick={() => setDetail(r)}>查看资料</Button>{manage && r.sync?.status !== 'SYNCED' && <Button type="link" disabled={busy} onClick={() => void retry(r.id)}>补同步/重试</Button>}</Space> },
    ]} />
    <Modal okText="确定" cancelText="取消" title={detail?.title} open={!!detail} width={850} footer={null} onCancel={() => setDetail(undefined)} destroyOnHidden>
      {detail && <><Descriptions column={1} bordered items={Object.entries(detail.content).map(([key, value]) => ({ key, label: detail.formSnapshot?.formSchema?.fields?.find(f => f.key === key)?.label || ({ amount: '金额', category: '类别', reason: '事由', period: '工资月份', caseNo: '案件编号' } as Record<string, string>)[key] || key, children: typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—') }))} /><ApprovalAttachments instanceId={detail.id} /></>}
    </Modal>
    <Modal title="自定义审批同步目标" open={configure} footer={null} width={750} onCancel={() => setConfigure(false)}>
      <Alert type="info" title="报销成本要求原申请包含 amount（金额）；可选 category、reason、occurredAt、caseNo。配置后对待处理记录点击重试。" />
      <Table<SyncRule> rowKey="id" dataSource={rules} columns={[{ title: '类型名称', dataIndex: 'name' }, { title: '同步到', key: 'target', render: (_, r) => <Select style={{ width: 210 }} placeholder="待配置" value={r.syncRule?.target} options={['COST', 'LEAVE', 'SEAL', 'CONTRACT_CHANGE', 'CUSTOM'].map(value => ({ value, label: targets[value] }))} onChange={async value => { try { await integrationApi.setRule(r.id, value); setRules((await integrationApi.rules()).data); message.success('配置已保存'); } catch { message.error('配置未保存'); } }} /> }]} />
    </Modal>
  </div>;
}
