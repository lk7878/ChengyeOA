import { Select } from 'antd';
import { useEffect, useState } from 'react';
import { get } from '@/features/workspaces/api';
import { payError, payUrl, type PayView } from './case-pay-types';

export function SettlementRecipient({ settlementId, value, onChange, id }: {
  settlementId: string; id?: string; value?: string; onChange?: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<PayView['accounts']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const users = await get<PayView['accounts']>(payUrl + '/' + settlementId + '/recipients?q=' + encodeURIComponent(query));
        if (current) setAccounts(users);
      } catch (cause) {
        if (current) setError(payError(cause));
      } finally {
        if (current) setLoading(false);
      }
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [settlementId, query]);
  return <Select id={id} value={value} onChange={onChange} loading={loading}
    placeholder="选择账号或输入姓名、用户名搜索"
    showSearch={{ filterOption: false, onSearch: (text) => {
      if (query !== text) { setQuery(text); setLoading(true); setError(''); setAccounts([]); }
    } }}
    notFoundContent={error || (loading ? '查询中…' : '没有匹配的启用账号')}
    options={accounts.map((u) => ({ value: u.id, label: u.employee?.name ? u.employee.name + '（' + u.username + '）' : u.username }))}
  />;
}
