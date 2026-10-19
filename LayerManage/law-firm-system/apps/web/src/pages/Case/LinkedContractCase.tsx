import { useEffect, useState } from 'react';
import { Alert } from 'antd';
import { Link } from 'react-router';
import { caseApi } from '@/api/business';
import { useAuthStore } from '@/stores/authStore';
import { errorMessage } from '@/features/workspaces/api';
import type { Case } from '@/types';

export default function LinkedContractCase({
  contractId,
  revision,
}: {
  contractId?: string;
  revision?: number;
}) {
  const canRead = useAuthStore((s) => s.hasPermission('case.read'));
  const [result, setResult] = useState<{ contractId: string; row?: Case; error?: string }>();
  useEffect(() => {
    let active = true;
    if (contractId && canRead)
      void caseApi
        .list({ contractId, page: 1, pageSize: 1 })
        .then((res) => {
          if (active) setResult({ contractId, row: res.data.list[0] });
        })
        .catch((e) => {
          if (active) setResult({ contractId, error: errorMessage(e) });
        });
    return () => {
      active = false;
    };
  }, [contractId, revision, canRead]);
  if (!canRead || !contractId || result?.contractId !== contractId) return null;
  if (result.error) return <Alert type="error" title={result.error} />;
  if (!result.row) return null;
  return (
    <Alert
      type="info"
      showIcon
      title={
        <>
          该合同已有案件 {result.row.caseNo}，请继续填写或办理。{' '}
          <Link to={'/cases/' + result.row.id}>打开已有案件</Link>
        </>
      }
    />
  );
}
