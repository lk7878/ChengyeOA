import { useEffect, useState } from 'react';
import { Button, Select, Space, Typography } from 'antd';
import { get, errorMessage } from './api';
interface UpstreamChoice {
  id: string;
  label: string;
  preview?: Record<string, unknown>;
  disabled?: boolean;
  disabledReason?: string;
}
interface ChoicesResult {
  rows: UpstreamChoice[];
  hasMore: boolean;
  sourceKind?: 'AFTER_SALES';
}
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
  const [rows, setRows] = useState<UpstreamChoice[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sourceKind, setSourceKind] = useState<ChoicesResult['sourceKind']>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    if (page === 1) {
      setRows([]);
      setMore(false);
    }
    const timer = setTimeout(() => {
      void get<ChoicesResult>(
        `/tables/${tableId}/lifecycle-choices?keyword=${encodeURIComponent(keyword)}&page=${page}`,
      )
        .then((r) => {
          if (live) {
            setRows((previous) =>
              page === 1
                ? r.rows
                : [...new Map([...previous, ...r.rows].map((row) => [row.id, row])).values()],
            );
            setMore(r.hasMore);
            setSourceKind(r.sourceKind);
          }
        })
        .catch((e) => {
          if (live) {
            setError(errorMessage(e));
            setRows([]);
            setMore(false);
          }
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tableId, keyword, page, revision]);
  const selected = typeof value === 'string' ? value : undefined;
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Select
        aria-label="选择上游业务记录"
        style={{ width: '100%' }}
        disabled={disabled}
        loading={loading}
        showSearch
        filterOption={false}
        value={selected}
        onChange={(id) => {
          const row = rows.find((r) => r.id === id);
          if (loading || error || !row || row.disabled) return;
          onChange(id);
          onPreview?.(row.preview ?? {});
        }}
        onSearch={(q) => {
          setKeyword(q);
          setPage(1);
        }}
        placeholder="搜索合同编号、案件编号或名称"
        notFoundContent={
          loading
            ? '正在加载关联记录…'
            : error
              ? '加载失败，请点击刷新关联项重试。'
              : sourceKind === 'AFTER_SALES'
                ? '未找到匹配且有权查看的售后记录，请检查搜索条件及售后权限。'
                : '未找到匹配且有权查看的业务记录。'
        }
        optionRender={(option) => (
          <div>
            <div>{option.label}</div>
            {option.data.disabledReason && (
              <div style={{ whiteSpace: 'normal', fontSize: 12 }}>{option.data.disabledReason}</div>
            )}
          </div>
        )}
        options={[
          ...(selected && !rows.some((r) => r.id === selected)
            ? [{ value: selected, label: label || selected, disabled: true, disabledReason: undefined }]
            : []),
          ...rows.map((r) => ({
            value: r.id,
            label: r.label,
            disabled: loading || !!error || r.disabled,
            disabledReason: r.disabledReason,
          })),
        ]}
      />
      {sourceKind === 'AFTER_SALES' && (
        <Typography.Text type="secondary">
          在售后管理表的行操作中，将“协商状态”设为“协商未果 /
          需退款”并保存，再刷新关联项。选择售后记录并保存退款信息后，才会生成退费记录。
        </Typography.Text>
      )}
      <Button
        size="small"
        aria-label="刷新关联项"
        loading={loading}
        disabled={loading}
        onClick={() => {
          setPage(1);
          setRevision((r) => r + 1);
        }}
      >
        刷新关联项
      </Button>
      {more && (
        <Button size="small" disabled={loading} onClick={() => setPage((p) => p + 1)}>
          加载更多关联项
        </Button>
      )}
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
    </Space>
  );
}
