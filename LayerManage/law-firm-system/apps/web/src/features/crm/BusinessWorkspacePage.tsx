import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Space, Spin } from 'antd';
import { Link, useSearchParams } from 'react-router';
import CreateModuleBase from './CreateModuleBase';
import { financeContextParams, financialSources } from '@/pages/finance/context';
import { businessSources, type BusinessSource } from './business-sources';
import { get, errorMessage } from '../workspaces/api';
import { WorkspaceEditor } from '@/pages/Workspaces';

export interface BusinessDirectory {
  tables: { id: string; name: string; source?: string; lifecycleKind?: string | null; inventoryKind?: string | null; baseId: string; baseName: string; workspaceName: string }[];
  targets: { id: string; name: string; workspaceName: string }[];
}
export function BusinessTableLinks({
  recordId,
  source = 'LEADS',
}: {
  recordId: string;
  source?: BusinessSource;
}) {
  const [linkParams] = useSearchParams();
  const [data, setData] = useState<BusinessDirectory>();
  useEffect(() => {
    let active = true;
    void get<BusinessDirectory>(
      '/collaboration/business-tables?source=' + source + '&recordId=' + encodeURIComponent(recordId),
    )
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setData(undefined);
      });
    return () => {
      active = false;
    };
  }, [recordId, source]);
  return (
    <>
      {data?.tables.map((table) => (
        <Link
          key={table.id}
          to={
            businessSources[source].path +
            '?' +
            new URLSearchParams({
              ...(financialSources.includes(source) ? financeContextParams(linkParams) : {}),
              base: table.baseId,
              table: table.id,
              record: recordId,
            })
          }
        >
          在「{table.name}」中打开
        </Link>
      ))}
    </>
  );
}
export default function BusinessWorkspacePage({ source = 'LEADS' }: { source?: BusinessSource }) {
  const [params] = useSearchParams();
  if (params.get('base')) return <WorkspaceEditor businessMode />;
  return <BusinessDirectoryPage key={source} source={source} />;
}
function BusinessDirectoryPage({ source }: { source: BusinessSource }) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<BusinessDirectory>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const retired = ['SOP_TASKS','QUALITY_ANALYSES','QUALITY_REVIEWS','QUALITY_ISSUES'].includes(source);
  useEffect(() => {
    let active = true;
    get<BusinessDirectory>('/collaboration/business-tables?source=' + source)
      .then(value => { if (active) { setData(value); setError(''); } })
      .catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [source, revision]);
  return <div className="unified-area-page">
    <div className="unified-area-heading"><h1>{businessSources[source].title}{retired && '历史归档'}</h1>
      <Space>{!retired && <CreateModuleBase source={source} onCreated={(base, table) => setParams({...Object.fromEntries(params),base,table})}/>}
        <Button onClick={()=>setRevision(n=>n+1)}>刷新工作表</Button></Space></div>
    {retired && <Alert type="info" title="该模块已停用，历史记录仅供获授权人员查阅。"/>}
    {error && <Alert type="error" title={error}/>}
    {!data && !error && <Spin aria-label="正在加载业务工作表"/>}
    {data && !data.tables.length && <Empty description="暂无可访问的工作表"/>}
    <div className="unified-app-grid">{data?.tables.map(table=>
      <Link className="unified-app-card" key={table.id}
        to={'?'+new URLSearchParams({...Object.fromEntries(params),base:table.baseId,table:table.id})}>
        <span><strong>{table.name}</strong><small>{table.workspaceName} / {table.baseName}</small></span>
      </Link>)}</div>
  </div>;
}
