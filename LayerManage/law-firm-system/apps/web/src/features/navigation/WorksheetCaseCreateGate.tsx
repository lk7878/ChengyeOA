import { useEffect, useState, type ReactNode } from 'react';
import { Result, Spin } from 'antd';
import { Link } from 'react-router';
import { get } from '@/features/workspaces/api';
import type { TableDetail } from '@/features/workspaces/types';
import { useAuthStore } from '@/stores/authStore';

/** A table grant opens only its own create form, never the global case-create route. */
export default function WorksheetCaseCreateGate({ tableId, children }: { tableId: string; children: ReactNode }) {
  const authorization = useAuthStore(state => state.authorization);
  const [allowed, setAllowed] = useState<boolean>();
  useEffect(() => {
    let active = true;
    void get<TableDetail>('/tables/' + encodeURIComponent(tableId)).then(detail => {
      if (active) setAllowed(detail.table.source === 'CASES' && detail.access.level >= 2 && detail.access.add !== false &&
        !!detail.businessPermissions?.includes('case.create'));
    }).catch(() => { if (active) setAllowed(false); });
    return () => { active = false; };
  }, [tableId, authorization]);
  if (allowed === undefined) return <div aria-label="正在核对表格建案权限"><Spin /></div>;
  if (!allowed) return <Result status="403" title="当前工作表不允许新建案件" extra={<Link to="/cases">返回案件管理</Link>} />;
  return children;
}
