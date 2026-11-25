import FilePreviewButton from '@/features/files/FilePreviewButton';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Statistic, Table, Tabs, Tag, message } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { errorMessage, get } from '../workspaces/api';
import { downloadVersion, versionUrl } from './file-transfer';
import './storage.css';

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '不可用';
  const unit = bytes >= 1024 ** 3 ? 3 : bytes >= 1024 ** 2 ? 2 : bytes >= 1024 ? 1 : 0;
  return `${(bytes / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit ? 2 : 0 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
};
type Row = { tableId?: string; id: string; fileId: string; version: number; name: string; kind: string; ownerId: string; ownerName: string;
  department: string; workspaceName: string; location: string; size: number; current: boolean; trash: boolean;
  sha256: string; updatedAt: string; source: string; referenceCount: number; candidates: string[]; versionCount: number };
type Group = { name: string; versions: number; bytes: number };
export type StorageReport = { audience: string; workspace: string; workspaces: { id: string; name: string }[];
  disk: { total: number; used: number; available: number } | null;
  measured: { bytes: number; allocatedBytes: number; unavailable: number; objects: number };
  totals: { files: number; versions: number; logicalBytes: number; currentBytes: number; historyBytes: number; trashBytes: number; aiBytes: number; duplicateGroups: number; potentialDuplicateBytes: number };
  breakdown: { members: Group[]; departments: Group[]; workspaces: Group[] };
  owners: { id: string; name: string }[]; departments: string[]; items: Row[]; total: number; page: number; pageSize: number;
  coverage: string; referenceNotice: string; computedAt: string };
const candidates: Record<string, string> = { all: '全部文件版本', duplicate: '内容重复', history: '历史版本', trash: '回收站', large: '大文件（≥100 MB）', old: '超过180天未更新' };

export default function StorageManager({ workspace, onWorkspaces, onMine }: {
  workspace: string; onWorkspaces: (items: { id: string; name: string }[]) => void; onMine: () => void;
}) {
  const authorization = useAuthStore(s => s.authorization);
  const superAdmin = !!authorization?.isSystemSuperAdmin;
  const [audience, setAudience] = useState('mine');
  const [q, setQ] = useState(''), [ownerId, setOwnerId] = useState(''), [department, setDepartment] = useState('');
  const [candidate, setCandidate] = useState('all'), [sort, setSort] = useState('size');
  const [pageSelection, setPageSelection] = useState({ workspace, page: 1 });
  const page = pageSelection.workspace === workspace ? pageSelection.page : 1;
  const setPage = (value: number) => setPageSelection({ workspace, page: value });
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [result, setResult] = useState<{ key: string; data: StorageReport }>();
  const effectiveAudience = superAdmin ? audience : 'mine';
  const query = new URLSearchParams({ audience: effectiveAudience, workspace, q, ownerId, department, candidate, sort, page: String(page) }).toString();
  // Do not display the previous scope's data while switching identities or filters.
  const requestKey = `${authorization?.userId}:${query}:${revision}`;
  const data = result?.key === requestKey ? result.data : undefined;
  useEffect(() => {
    let active = true;
    onWorkspaces([]);
    void get<StorageReport>('/storage-management?' + query).then(report => {
      if (active) { setResult({ key: requestKey, data: report }); onWorkspaces(report.workspaces); setError(''); }
    }).catch(e => { if (active) { setResult(undefined); setError(errorMessage(e)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, requestKey, onWorkspaces]);
  const update = (fn: () => void) => { setPage(1); setLoading(true); setError(''); fn(); };
  return <section className="storage-manager" aria-label="存储管理">
    <Space wrap className="storage-heading"><h2>存储管理</h2>
      <Select aria-label="存储查看范围" value={effectiveAudience} onChange={value => update(() => { setAudience(value); setOwnerId(''); setDepartment(''); })}
        options={[{ value: 'mine', label: '我的占用' }, ...(superAdmin ? [{ value: 'organization', label: '全组织（只读审计）' }] : [])]} />
      <Button onClick={() => update(() => setRevision(r => r + 1))}>刷新统计</Button>
      <Button onClick={onMine}>管理我的文件 / 回收站</Button>
    </Space>
    <p>范围：{workspace === '__all__' ? '全部工作区及未归属工作区文件' : workspace === '__unassigned__' ? '未归属工作区文件' : data?.workspaces.find(w => w.id === workspace)?.name || '所选工作区'} · {effectiveAudience === 'organization' ? '跨用户查看已记录审计；此处不授予修改和删除权。' : '仅统计本人文件，不包含其他成员共享给我的副本。'}</p>
    {error && <Alert type="error" title={error} />}
    {data && <>
      <div className="storage-stats">{[
        ['文件大小合计（含全部版本）', data.totals.logicalBytes], ['当前文件', data.totals.currentBytes],
        ['历史版本', data.totals.historyBytes], ['回收站（含历史）', data.totals.trashBytes],
        ['已同步 AI 成果（包含于上述合计）', data.totals.aiBytes], ['已核对文件实际占用', data.measured.allocatedBytes],
      ].map(([label, value]) => <Card size="small" key={String(label)}><Statistic title={label} value={formatBytes(Number(value))} /></Card>)}</div>
      <p>{data.totals.files} 个文件 · {data.totals.versions} 个内容版本 · 已核对 {data.measured.objects} 个独立存储对象。同一路径或硬链接仅计算一次实际占用。</p>
      {data.measured.unavailable > 0 && <Alert type="warning" title={`${data.measured.unavailable} 个存储对象不可核对，实际占用为已核对部分，不代表完整容量。`} />}
      {effectiveAudience === 'organization' && <Alert type="info" title={data.disk ? `个人文件所在磁盘：总容量 ${formatBytes(data.disk.total)} · 已用 ${formatBytes(data.disk.used)} · 可用 ${formatBytes(data.disk.available)}` : '磁盘容量暂不可用'} />}
      <Tabs items={(['workspaces', 'members', 'departments'] as const).map((key, index) => ({ key, label: ['按工作区', '按成员', '按部门'][index], children:
        <Table size="small" rowKey="name" dataSource={data.breakdown[key]} pagination={{ pageSize: 8, showSizeChanger: false }} columns={[
          { title: ['工作区', '成员', '部门'][index], dataIndex: 'name' }, { title: '版本数', dataIndex: 'versions' },
          { title: '文件大小合计', dataIndex: 'bytes', render: formatBytes },
        ]} /> }))} />
      <p>相同内容：{data.totals.duplicateGroups} 组 · 重复逻辑大小上限 {formatBytes(data.totals.potentialDuplicateBytes)}。不等于可安全释放的物理空间；未记录内容校验值的文件不参与判重。</p>
    </>}
    <Space wrap className="storage-filters">
      <Input.Search aria-label="搜索存储文件" placeholder="文件名或位置" allowClear onSearch={value => update(() => setQ(value))} />
      <Select aria-label="存储成员筛选" value={ownerId} onChange={value => update(() => setOwnerId(value))} options={[{ value: '', label: '全部成员' }, ...(data?.owners || []).map(o => ({ value: o.id, label: o.name }))]} />
      <Select aria-label="存储部门筛选" value={department} onChange={value => update(() => setDepartment(value))} options={[{ value: '', label: '全部部门' }, ...(data?.departments || []).map(name => ({ value: name, label: name }))]} />
      <Select aria-label="清理候选筛选" value={candidate} onChange={value => update(() => setCandidate(value))} options={Object.entries(candidates).map(([value, label]) => ({ value, label }))} />
      <Select aria-label="存储排序" value={sort} onChange={value => update(() => setSort(value))} options={[{ value: 'size', label: '大小降序' }, { value: 'updatedAt', label: '最近更新' }, { value: 'name', label: '文件名称' }]} />
    </Space>
    <Table<Row> rowKey="id" loading={loading || (!data && !error)} dataSource={data?.items || []} scroll={{ x: 1100 }}
      pagination={{ current: page, pageSize: 25, total: data?.total || 0, showSizeChanger: false, onChange: value => { setLoading(true); setPage(value); } }} columns={[
        { title: '文件 / 位置', width: 260, render: (_, row) => <><strong>{row.name}</strong><div>{row.location}</div>{row.sha256 && <details><summary>内容校验值</summary><small className="storage-hash">{row.sha256}</small></details>}</> },
        { title: '所属工作区', dataIndex: 'workspaceName', width: 180 }, { title: '所有者 / 部门', width: 160, render: (_, row) => <>{row.ownerName}<div>{row.department}</div></> },
        { title: '大小', dataIndex: 'size', render: formatBytes, width: 110 },
        { title: '版本 / 状态', width: 180, render: (_, row) => <>v{row.version} / 共{row.versionCount}版<div>{row.trash ? '回收站' : row.current ? '当前版本' : '历史版本'}</div>{row.candidates.map(c => <Tag key={c}>{candidates[c]}</Tag>)}</> },
        { title: '更新 / 引用', width: 180, render: (_, row) => <>{new Date(row.updatedAt).toLocaleString()}<div>归档记录 {row.referenceCount} 项</div></> },
        { title: '操作', render: (_, row) => row.kind === 'PERSONAL' && !row.trash ? <Space><FilePreviewButton url={versionUrl(row.fileId, row.version, effectiveAudience === 'organization')} name={row.name} /><Button onClick={() => void downloadVersion(row.fileId, row.version, row.name, effectiveAudience === 'organization').catch(e => message.error(errorMessage(e)))}>下载</Button></Space> : row.tableId && !row.trash ? <FilePreviewButton url={`/api/v1/tables/${row.tableId}/files/${row.fileId}`} name={row.name} /> : '请在原资源中管理' },
      ]} />
    {data && <><Alert type="warning" title="清理候选需人工核对" description={data.referenceNotice} /><p>统计时间：{new Date(data.computedAt).toLocaleString()}</p></>}
  </section>;
}
