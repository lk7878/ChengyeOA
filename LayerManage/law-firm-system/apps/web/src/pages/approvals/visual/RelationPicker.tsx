import { useEffect, useState } from 'react';
import { Alert, Button, Select, Space, Spin } from 'antd';
import { get, post, errorText, type FormField, type TableSchema } from './api';
import { relationSnapshot, type RelationRecord, type RelationSnapshot } from '../../../../../server/app/domain/workflow/relation-display';

export function RelationDetails({ snapshot, submitted = false }: { snapshot: RelationSnapshot; submitted?: boolean }) {
  return <div className="wf-relation-details">
    {snapshot.references.length > 0 && <dl>{snapshot.references.map(item =>
      <div key={item.fieldId}><dt>{item.name}</dt><dd>{item.text}</dd></div>)}</dl>}
    {submitted && <small>提交时引用内容{snapshot.version != null ? ` · 记录版本 v${snapshot.version}` : ''}</small>}
  </div>;
}

export default function RelationPicker({ tableId, value, onChange, disabled = false, field, saved }: {
  tableId: string; value?: string; onChange: (id: string | undefined) => void; disabled?: boolean;
  field?: FormField; saved?: RelationSnapshot;
}) {
  const [rows, setRows] = useState<RelationRecord[]>([]);
  const [schema, setSchema] = useState<TableSchema>();
  const [selected, setSelected] = useState<RelationRecord>();
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false), [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(''), [detailError, setDetailError] = useState('');
  const [retry, setRetry] = useState(0);
  const frozen = saved && saved.recordId === value && saved.tableId === tableId ? saved : undefined;
  const onlySnapshot = disabled && !!frozen;
  useEffect(() => {
    if (onlySnapshot) return;
    let live = true;
    queueMicrotask(() => { if (live) { setLoading(true); setError(''); } });
    Promise.all([
      get<TableSchema>(`/tables/${tableId}`),
      disabled ? Promise.resolve({ records: [] as RelationRecord[], total: 0 }) :
        post<{ records: RelationRecord[]; total: number }>(`/tables/${tableId}/records/query`, { page, pageSize: 50 }),
    ]).then(([s, data]) => {
      if (!live) return;
      setSchema(s); setRows(old => page === 1 ? data.records : [...old, ...data.records]); setTotal(data.total);
    }).catch(e => { if (live) { setError(errorText(e)); setRows([]); setSchema(undefined); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [tableId, page, disabled, onlySnapshot, retry]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => { if (live) { setSelected(undefined); setDetailError(''); setDetailLoading(!!value && !frozen); } });
    if (!value || frozen) return () => { live = false; };
    get<{ record: RelationRecord }>(`/tables/${tableId}/records/${encodeURIComponent(value)}`)
      .then(data => { if (live) setSelected(data.record); })
      .catch(e => { if (live) setDetailError(errorText(e)); })
      .finally(() => { if (live) setDetailLoading(false); });
    return () => { live = false; };
  }, [tableId, value, frozen, retry]);
  const config = field ?? { key: 'record', label: '业务记录', type: 'relation', tableId };
  const snapshot = frozen ?? (selected && selected.id === value && schema ? relationSnapshot(config, schema.fields, selected) : undefined);
  const options = schema ? rows.map(r => ({ value: r.id, label: relationSnapshot(config, schema.fields, r).label })) : [];
  if (value && !options.some(o => o.value === value)) options.push({ value, label: snapshot?.label ?? (detailLoading ? '正在加载关联记录…' : '关联记录不可读取') });
  return <div>
    <Space.Compact style={{ width: '100%' }}>
      <Select aria-label={field?.label ?? '关联业务记录'} style={{ width: '100%' }} disabled={disabled}
        loading={loading} showSearch allowClear optionFilterProp="label" value={value || undefined}
        onChange={onChange} placeholder="选择有权访问的业务记录" options={options} />
      {!disabled && rows.length < total && <Button loading={loading} onClick={() => setPage(p => p + 1)}>加载更多</Button>}
    </Space.Compact>
    {(error || detailError) && <Alert type="warning" title={error || detailError}
      action={<Button size="small" onClick={() => setRetry(n => n + 1)}>重试</Button>} />}
    {detailLoading && <Spin size="small" />}
    {snapshot && <RelationDetails snapshot={snapshot} submitted={!!frozen} />}
  </div>;
}
