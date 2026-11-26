import { useEffect, useState } from 'react';
import { Alert, Button, Pagination, Select } from 'antd';
import { requestErrorMessage } from '@/api/errors';
export interface FinanceChoice {
  id: string;
  label: string;
  amount?: string;
  remaining?: string;
  contractNo?: string;
  customerName?: string;
  caseNo?: string;
  caseTitle?: string;
  status?: string;
  organizationName?: string;
}
export type ChoiceLoader = (
  page: number,
  search: string,
) => Promise<{ list: FinanceChoice[]; total: number }>;
export default function FinanceChoicePicker({
  id,
  value,
  onChange,
  onPick,
  load,
  label,
  disabled,
  valueChoice,
}: {
  id?: string;
  value?: string;
  onChange?: (id?: string) => void;
  onPick?: (choice?: FinanceChoice) => void;
  load: ChoiceLoader;
  label: string;
  disabled?: boolean;
  valueChoice?: FinanceChoice;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ list: FinanceChoice[]; total: number }>({ list: [], total: 0 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<FinanceChoice>();
  useEffect(() => {
    if (disabled) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void load(page, search)
        .then((data) => {
          if (active) {
            setResult(data);
            setError('');
          }
        })
        .catch((e) => {
          if (active) {
            setResult({ list: [], total: 0 });
            setError(requestErrorMessage(e));
          }
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load, page, search, revision, disabled]);
  const currentChoice = valueChoice?.id === value ? valueChoice : selected;
  const choices =
    currentChoice && currentChoice.id === value && !result.list.some((row) => row.id === value)
      ? [currentChoice, ...result.list]
      : result.list;
  return (
    <>
      <Select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        loading={busy}
        showSearch={{
          filterOption: false,
          onSearch: (text) => {
            setSearch(text);
            setPage(1);
          },
        }}
        allowClear
        placeholder={'搜索或选择' + label}
        options={choices.map((row) => ({ value: row.id, label: row.label }))}
        onChange={(id) => {
          const row = choices.find((item) => item.id === id);
          setSelected(row);
          onChange?.(id);
          onPick?.(row);
        }}
      />
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={() => setRevision((n) => n + 1)}>重试选项</Button>}
        />
      )}
      {!disabled && result.total > 20 && (
        <Pagination
          size="small"
          current={page}
          pageSize={20}
          total={result.total}
          showSizeChanger={false}
          onChange={setPage}
        />
      )}
    </>
  );
}
