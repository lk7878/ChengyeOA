import { useEffect, useState } from 'react';
import { Alert, Button, Input, Space, Table, Tag } from 'antd';
import { errorMessage, post } from '@/features/workspaces/api';
import { allTables, tableOptions, type TableOption } from './worksheet-permission-options';
export type OverviewSubject = { id: string; target: 'MEMBER' | 'ROLE'; label: string };
type Row = { tableId: string; tableName: string; subject: OverviewSubject; level: number;
  limitedRows: boolean; limitedFields: boolean; limitedViews: boolean };
type Batch = { rows: Row[]; checked: number; totalCandidates: number; nextOffset: number | null };

export default function PermissionOverview({ table, subject, tables, onPreview }:
  { table?: string; subject: string; tables: TableOption[]; onPreview: (table: string, subject: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState({ checked: 0, total: 0, loading: true });
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const [target, id] = subject.split(':');
      let offset = 0;
      const collected: Row[] = [];
      try {
        do {
          const batch = await post<Batch>('/permission-overview', {
            ...(table && table !== allTables ? { tableId: table } : {}), target,
            ...(['MEMBER', 'ROLE'].includes(target) ? { id } : {}), offset,
          });
          if (!live) return;
          collected.push(...batch.rows);
          setRows([...collected]);
          setProgress({ checked: batch.checked, total: batch.totalCandidates, loading: batch.nextOffset !== null });
          if (batch.nextOffset === null) break;
          offset = batch.nextOffset;
        } while (live);
      } catch (e) {
        if (live) { setError(errorMessage(e)); setProgress(p => ({ ...p, loading: false })); }
      }
    };
    void load();
    return () => { live = false; };
  }, [table, subject, revision]);
  const names = new Map(tableOptions(tables).map(t => [t.value, t.label]));
  const filtered = rows.filter(r => `${names.get(r.tableId) || r.tableName} ${r.subject.label}`.toLowerCase().includes(keyword.trim().toLowerCase()));
  return <section aria-label="授权汇总">
    <h2>授权汇总</h2>
    <Alert type="info" title="显示当前生效的访问权限，包含角色授权、工作区成员及直接分享。角色行表示单个角色，成员行合并该成员的全部有效授权。"
      description="仅汇总启用成员和业务角色。没有数据记录的表仍会列出；记录范围、字段和业务操作限制继续生效。此查询不会修改授权。" />
    <Space wrap style={{ margin: '16px 0' }}>
      <Input aria-label="筛选授权结果" placeholder="搜索表格、成员或角色名称" value={keyword} onChange={e => { setKeyword(e.target.value); setPage(1); }} allowClear />
      <span role="status">{progress.loading ? `正在核对 ${progress.checked} / ${progress.total} 项` : error ? '查询未完成，以下为部分结果' : `已核对 ${progress.total} 项`} · {rows.length} 项授权</span>
      <Button disabled={progress.loading} onClick={() => { setRows([]); setError(''); setPage(1); setProgress({ checked: 0, total: 0, loading: true }); setRevision(r => r + 1); }}>刷新汇总</Button>
    </Space>
    {error && <Alert type="error" title={error} />}
    <Table rowKey={r => `${r.tableId}:${r.subject.target}:${r.subject.id}`} size="small" dataSource={filtered}
      loading={progress.loading && !rows.length} scroll={{ x: 820 }}
      locale={{ emptyText: progress.loading ? '正在核对权限…' : error ? '查询失败，请刷新重试' : '没有符合条件的有效授权' }}
      pagination={{ current: page, pageSize: 25, showSizeChanger: false, total: filtered.length, onChange: setPage }} columns={[
        { title: '表格 / 所属应用', key: 'table', render: (_, r) => names.get(r.tableId) || r.tableName },
        { title: '授权对象', key: 'subject', render: (_, r) => <><Tag>{r.subject.target === 'MEMBER' ? '成员' : '角色'}</Tag>{r.subject.label}</> },
        { title: '权限等级', dataIndex: 'level', render: (level: number) => ['无权限', '查看', '编辑', '管理', '所有者'][level] },
        { title: '范围限制', key: 'limits', render: (_, r) => [r.limitedRows && '记录范围', r.limitedFields && '字段限制', r.limitedViews && '视图限制'].filter(Boolean).join('、') || '按业务规则' },
        { title: '操作', key: 'action', render: (_, r) => <Button onClick={() => onPreview(r.tableId, `${r.subject.target}:${r.subject.id}`)}>预览表格</Button> },
      ]} />
  </section>;
}
