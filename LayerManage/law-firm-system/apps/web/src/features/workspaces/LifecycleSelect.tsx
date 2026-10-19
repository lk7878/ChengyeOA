import { useEffect, useState } from 'react';
import { Button, Select, Space, Typography } from 'antd';
import { get, errorMessage } from './api';
export default function LifecycleSelect({
  tableId,
  value,
  onChange,
  disabled,
  label,
  onPreview,
}: {
  tableId: string;
  value: unknown;
  onChange(value: unknown): void;
  disabled?: boolean;
  label?: string;
  onPreview?(values: Record<string, unknown>): void;
}) {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Array<{ id: string; label: string; preview?: Record<string, unknown> }>>(
    [],
  );
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void get<{ rows: typeof rows; hasMore: boolean }>(
        `/tables/${tableId}/lifecycle-choices?keyword=${encodeURIComponent(keyword)}&page=${page}`,
      )
        .then((r) => {
          if (live) {
            setRows((previous) => (page === 1 ? r.rows : [...previous, ...r.rows]));
            setMore(r.hasMore);
            setError('');
          }
        })
        .catch((e) => {
          if (live) setError(errorMessage(e));
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tableId, keyword, page]);
  const selected = typeof value === 'string' ? value : undefined;
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Select
        aria-label="选择上游业务记录"
        style={{ width: '100%' }}
        disabled={disabled}
        showSearch
        filterOption={false}
        value={selected}
        onChange={(id) => {
          onChange(id);
          onPreview?.(rows.find((r) => r.id === id)?.preview ?? {});
        }}
        onSearch={(q) => {
          setKeyword(q);
          setPage(1);
        }}
        placeholder="搜索合同编号、案件编号或名称"
        options={[
          ...(selected && !rows.some((r) => r.id === selected)
            ? [{ value: selected, label: label || selected }]
            : []),
          ...rows.map((r) => ({ value: r.id, label: r.label })),
        ]}
      />
      {more && (
        <Button size="small" onClick={() => setPage((p) => p + 1)}>
          加载更多关联项
        </Button>
      )}
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
    </Space>
  );
}
