import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Spin } from 'antd';
import { Link, Navigate, useSearchParams } from 'react-router';
import { WorkspaceEditor } from '@/pages/Workspaces';
import { get, errorMessage } from '@/features/workspaces/api';
import type { BusinessDirectory } from '@/features/crm/BusinessWorkspacePage';
import { inventoryWorksheetRoutes } from './worksheet-routes';

export default function InventoryWorksheetPage({ section }: { section: string }) {
  const [params] = useSearchParams();
  const config = inventoryWorksheetRoutes[section];
  return <>
    <title>{`${config.title} · 律师智慧管理系统`}</title>
    {params.get('base') && params.get('table')
      ? <WorkspaceEditor businessMode />
      : <WorksheetDestination key={section} kind={config.kind} title={config.title} />}
  </>;
}

function WorksheetDestination({ kind, title }: { kind: string; title: string }) {
  const [tables, setTables] = useState<BusinessDirectory['tables']>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void get<BusinessDirectory>('/collaboration/business-tables?source=INVENTORY_ITEMS&inventoryKind=' + kind)
      .then(data => { if (active) setTables(data.tables.filter(t => t.inventoryKind === kind)); })
      .catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [kind, revision]);
  const destination = (table: BusinessDirectory['tables'][number]) => '?' + new URLSearchParams({ base: table.baseId, table: table.id });
  if (tables?.length === 1) return <Navigate replace to={destination(tables[0])} />;
  const retry = () => { setTables(undefined); setError(''); setRevision(n => n + 1); };
  return <div className="unified-area-page">
    <div className="unified-area-heading"><h1>{title}</h1><Link to="/inventory/items">返回物品工作表</Link></div>
    {error ? <Alert type="error" showIcon title="工作表加载失败" description={error} action={<Button onClick={retry}>重试</Button>} />
      : !tables ? <Spin aria-label="正在打开工作表" />
      : !tables.length ? <Empty description="未找到可访问的对应工作表，可能尚未创建、已归档或未获得授权。请联系工作区负责人。"><Button onClick={retry}>重新加载</Button></Empty>
      : <><p>请选择要打开的工作表。</p><div className="unified-app-grid">{tables.map(table =>
        <Link className="unified-app-card" key={table.id} to={destination(table)}><span><strong>{table.name}</strong><small>{table.workspaceName} / {table.baseName}</small></span></Link>,
      )}</div></>}
  </div>;
}
