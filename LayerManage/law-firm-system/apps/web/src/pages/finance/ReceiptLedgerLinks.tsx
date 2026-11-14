import { useEffect, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { Link } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { get, errorMessage } from '@/features/workspaces/api';

export default function ReceiptLedgerLinks() {
  const allowed = useAuthStore((s) => s.hasPermission('payment.read'));
  const [tables, setTables] = useState<{ id: string; baseId: string; name: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (allowed)
      void get<{ tables: typeof tables }>('/collaboration/business-tables?source=PAYMENTS')
        .then((data) => {
          if (active) setTables(data.tables.filter((t) => !('source' in t) || t.source === 'PAYMENTS'));
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    return () => {
      active = false;
    };
  }, [allowed]);
  if (!allowed) return null;
  return (
    <section style={{ marginBottom: 20 }}>
      <h2>财务收款明细</h2>
      <p>
        每次到账单独登记并确认，可在表内维护收款时间及凭证。发票号码和开票状态从关联合同的已完成开票申请同步；开票金额不计入到账总额。
      </p>
      {error && <Alert type="error" title={error} />}
      <Space wrap>
        {tables.map((table) => (
          <Link
            key={table.id}
            to={'/invoices?' + new URLSearchParams({ base: table.baseId, table: table.id })}
          >
            <Button>{table.name}</Button>
          </Link>
        ))}
        <Link to="/payments/new">登记收款</Link>
      </Space>
    </section>
  );
}
