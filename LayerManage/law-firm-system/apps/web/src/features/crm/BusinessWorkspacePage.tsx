import Modal from '@/components/DraggableModal';
import NegotiationList from '@/pages/negotiations/NegotiationList';
import ModuleRecordList from './ModuleRecordList';
import CreateModuleBase from './CreateModuleBase';
import ChannelIdentityGaps from '@/pages/Channel/ChannelIdentityGaps';
import { financeContextParams, financialSources } from '@/pages/finance/context';
import { useAuthStore } from '@/stores/authStore';
import { businessSources, domainCreate, type BusinessSource } from './business-sources';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Form, Input, Select, Spin } from 'antd';
import { Link, useSearchParams } from 'react-router';
import { get, post, errorMessage } from '../workspaces/api';
import { WorkspaceEditor } from '@/pages/Workspaces';

interface BusinessDirectory {
  tables: { id: string; name: string; source?: string; baseId: string; baseName: string; workspaceName: string }[];
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
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ body: string; key: string } | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [form] = Form.useForm();
  const title = businessSources[source].title;
  const creation = domainCreate(source);
  const canCreate = useAuthStore((s) => !!creation && s.hasPermission(creation.permission));
  useEffect(() => {
    let active = true;
    void get<BusinessDirectory>('/collaboration/business-tables?source=' + source)
      .then((value) => {
        if (active) {
          setData(value);
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setData(undefined);
          setError(errorMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, [source, revision]);
  return (
    <div className="unified-area-page">
      <div className="unified-area-heading">
        <div>
          <h1>{title}</h1>
          <p>选择工作表，使用共同的记录、个人视图和业务办理。</p>
        </div>
        <div><CreateModuleBase source={source} onCreated={(base, table) => setParams({ ...Object.fromEntries(params), base, table })} /> <Button onClick={() => setRevision((n) => n + 1)}>刷新工作表</Button></div>
      </div>
      {source === 'CHANNELS' && <ChannelIdentityGaps />}
      {source === 'NEGOTIATIONS' && <NegotiationList />}
      {source !== 'NEGOTIATIONS' && <ModuleRecordList key={source} source={source} />}
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={() => setRevision((n) => n + 1)}>重试</Button>}
        />
      )}
      {!data && !error && <Spin aria-label="正在加载业务工作表" />}
      {data && (
        <>
          {!data.tables.length && <Empty description="暂无可访问的业务工作表" />}
          <div className="unified-app-grid">
            {data.tables.map((table) => (
              <Link
                className="unified-app-card"
                key={table.id}
                to={
                  '?' +
                  new URLSearchParams({ ...Object.fromEntries(params), base: table.baseId, table: table.id })
                }
              >
                <span>
                  <strong>{table.name}</strong>
                  <small>{table.source === 'CUSTOM' ? '普通数据表（独立录入）' : '业务工作表（同步正式记录）'}</small>
                  <small>
                    {table.workspaceName} / {table.baseName}
                  </small>
                </span>
              </Link>
            ))}
          </div>
          <p>业务工作表同步展示正式记录；普通数据表用于独立录入。打开工作表可通过“分享”和“权限”按人员或角色授权，业务操作仍需对应的角色权限。</p>
          {data.targets.length > 0 && (
            <Button type="primary" onClick={() => setConnecting(true)}>
              连接业务数据
            </Button>
          )}
          {creation && canCreate && (
            <Link
              style={{ marginLeft: 16 }}
              to={creation.path + (params.size ? '?' + params.toString() : '')}
            >
              {creation.label}
            </Link>
          )}
          <Link style={{ marginLeft: 16 }} to={"/workspaces?module=" + source}>
            进入云盘管理工作区
          </Link>
          {!data.tables.length && !data.targets.length && (
            <p>请联系工作区负责人连接业务数据并配置岗位权限。</p>
          )}
        </>
      )}
      <Modal
        title="连接业务数据"
        open={connecting}
        onCancel={() => setConnecting(false)}
        forceRender
        confirmLoading={busy}
        okText="连接"
        onOk={async () => {
          try {
            const values = await form.validateFields();
            setBusy(true);
            const fingerprint = JSON.stringify({ source, ...values });
            if (attempt.current?.body !== fingerprint)
              attempt.current = { body: fingerprint, key: crypto.randomUUID() };
            const table = await post<{ id: string }>(
              '/bases/' + values.baseId + '/tables',
              {
                source,
                name: values.name,
              },
              attempt.current!.key,
            );
            if (!mounted.current) return;
            setConnecting(false);
            setParams({ ...Object.fromEntries(params), base: values.baseId, table: table.id });
          } catch (e) {
            if (!(e as { errorFields?: unknown }).errorFields) setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>连接现有业务记录。字段扩展与视图独立配置，正式业务数据保持同源。</p>
        <Form form={form} layout="vertical" initialValues={{ name: title }}>
          <Form.Item name="baseId" label="多维表格应用" rules={[{ required: true }]}>
            <Select
              aria-label="连接到应用"
              options={data?.targets.map((base) => ({
                value: base.id,
                label: base.workspaceName + ' / ' + base.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="name" label="工作表名称" rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
