import { useEffect, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import BusinessWorkspacePage from '@/features/crm/BusinessWorkspacePage';
import { caseApi } from '@/api/business';
import { errorMessage } from '@/features/workspaces/api';
import CaseRecordPage from './CaseRecordPage';

export default function CaseWorkspacePage() {
  const location = useLocation();
  const [params] = useSearchParams();
  if (location.state?.resumeCase) return <CaseRecordPage />;
  if (params.get('caseNo') && !params.get('base')) return <CaseNumberLink caseNo={params.get('caseNo')!} />;
  return (
    <>
      <BusinessWorkspacePage source="CASES" />
    </>
  );
}
function CaseNumberLink({ caseNo }: { caseNo: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void caseApi
      .list({ caseNo, pageSize: 1 })
      .then((response) => {
        if (!active) return;
        const record = response.data.list.find((row) => row.caseNo === caseNo);
        if (record) navigate('/cases/' + record.id + location.search + location.hash, { replace: true });
        else setError('案件不存在或不在你的权限范围内。');
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [caseNo, location.search, location.hash, navigate, revision]);
  return error ? (
    <Alert
      type="error"
      title={error}
      action={<Button onClick={() => setRevision((v) => v + 1)}>重试</Button>}
    />
  ) : (
    <Spin aria-label="正在定位案件" />
  );
}
