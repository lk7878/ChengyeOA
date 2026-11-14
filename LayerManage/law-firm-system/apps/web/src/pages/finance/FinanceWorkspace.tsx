import { useEffect, useState } from 'react';
import { Alert, Button, Input, Space, Spin } from 'antd';
import { Link, useSearchParams } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { caseApi } from '@/api/business';
import { requestErrorMessage } from '@/api/errors';
import type { Case } from '@/types';
import BusinessWorkspacePage from '@/features/crm/BusinessWorkspacePage';
import type { BusinessSource } from '@/features/crm/business-sources';

export function FinanceTablePage({ source }: { source: BusinessSource }) {
  const [params] = useSearchParams();
  if (params.get('caseNo') && !params.get(source === 'COSTS' ? 'case' : 'contract'))
    return <FinanceWorkspace />;
  return <BusinessWorkspacePage source={source} />;
}
export default function FinanceWorkspace() {
  const [params, setParams] = useSearchParams();
  const caseNo = params.get('caseNo') || '';
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canReadCase = hasPermission('case.read');
  const [resolved, setResolved] = useState<{ number: string; record?: Case; error?: string }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!caseNo || !canReadCase) return;
    let active = true;
    void caseApi
      .list({ caseNo, page: 1, pageSize: 1 })
      .then((result) => {
        if (active)
          setResolved({
            number: caseNo,
            record: result.data.list[0],
            error: result.data.list.length ? undefined : '未找到可访问的案件，请核对编号。',
          });
      })
      .catch((e) => {
        if (active) setResolved({ number: caseNo, error: requestErrorMessage(e) });
      });
    const timer = window.setInterval(() => setRevision((n) => n + 1), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [caseNo, canReadCase, revision]);
  const current = resolved?.number === caseNo ? resolved : undefined;
  const record = current?.record;
  const items = [
    ['payment', '/payments', '收款工作表'],
    ['invoice', '/invoices', '发票工作表'],
    ['refund', '/refunds', '退款减免工作表'],
    ['cost', '/costs', '成本工作表'],
  ] as const;
  return (
    <div className="unified-area-page">
      <h1>财务工作区</h1>
      <p>共同工作表连接正式单据，个人视图、字段配置与办理状态保持同源。</p>
      {canReadCase && (
        <Input.Search
          key={caseNo}
          aria-label="案件编号查询"
          placeholder="输入完整案件编号"
          defaultValue={caseNo}
          allowClear
          enterButton="按案件查询"
          style={{ maxWidth: 500, marginBottom: 16 }}
          onSearch={(value) => setParams(value.trim() ? { caseNo: value.trim() } : {})}
        />
      )}
      {caseNo && !canReadCase && (
        <Alert type="warning" title="当前岗位没有案件读取权限，无法解析案件财务关联。" />
      )}
      {caseNo && canReadCase && !current && <Spin aria-label="正在查询案件财务" />}
      {current?.error && (
        <Alert
          type="error"
          title={current.error}
          action={<Button onClick={() => setRevision((n) => n + 1)}>重试</Button>}
        />
      )}
      {record && (
        <Space wrap style={{ marginBottom: 16 }}>
          <strong>
            {record.caseNo} · {record.title}
          </strong>
          <Link to={'/cases/' + record.id}>返回案件办理</Link>
        </Space>
      )}
      {record && !record.contractId && (
        <Alert
          type="info"
          title="该案件尚未关联合同，可登记案件成本；收款、发票和退款需先在案件中关联合同。"
        />
      )}
      {(!caseNo || record) && (
        <div className="unified-app-grid">
          {items
            .filter(([kind]) => hasPermission(`menu.${kind}`) && hasPermission(`${kind}.read`))
            .filter(([kind]) => !caseNo || kind === 'cost' || record?.contractId)
            .map(([kind, path, title]) => (
              <Link
                className="unified-app-card"
                key={kind}
                to={
                  path +
                  (record
                    ? '?' +
                      new URLSearchParams({
                        caseNo: record.caseNo,
                        case: record.id,
                        ...(record.contractId ? { contract: record.contractId } : {}),
                      })
                    : '')
                }
              >
                <span>
                  <strong>{title}</strong>
                  <small>{record ? '查看本案件关联单据' : '选择授权工作表与个人视图'}</small>
                </span>
              </Link>
            ))}
        </div>
      )}
      {caseNo && (
        <p>
          <Link to="/finance">清除案件查询</Link>
        </p>
      )}
    </div>
  );
}
