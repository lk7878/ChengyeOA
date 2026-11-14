import { channelTypes } from './channel-types';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Select, Spin } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { channelApi } from '@/api/organization';
import { requestErrorMessage } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { get } from '@/features/workspaces/api';
import type { Workspace, Directory } from '@/features/workspaces/types';

export default function ChannelCreatePage() {
  const [params] = useSearchParams(),
    navigate = useNavigate();
  const canCreate = useAuthStore((s) => s.hasPermission('channel.create'));
  const [form] = Form.useForm();
  const workspaceId = Form.useWatch('workspaceId', form);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(),
    [directory, setDirectory] = useState<{ id: string; data: Directory }>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const alive = useRef(true),
    attempt = useRef<{ body: string; key: string } | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    get<{ workspaces: Workspace[] }>('/workspaces')
      .then((r) => {
        if (active) {
          setWorkspaces(r.workspaces);
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setWorkspaces(undefined);
          setError(requestErrorMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    get<Directory>('/collaboration/options?workspaceId=' + encodeURIComponent(workspaceId))
      .then((data) => {
        if (active) setDirectory({ id: workspaceId, data });
      })
      .catch((e) => {
        if (active) {
          setDirectory(undefined);
          setError(requestErrorMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId, revision]);
  const organizations = directory && directory.id === workspaceId ? directory.data.organizations : [];
  const suffix = params.size ? '?' + params.toString() : '';
  return (
    <div className="unified-area-page">
      <Link to={'/channels' + suffix}>返回渠道工作表</Link>
      <h1>登记渠道</h1>
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={() => setRevision((n) => n + 1)}>重试加载</Button>}
        />
      )}
      {!canCreate ? (
        <Alert type="warning" title="暂无渠道登记权限" />
      ) : !workspaces ? (
        !error && <Spin />
      ) : (
        <Card style={{ maxWidth: 760 }}>
          <Form
            form={form}
            layout="vertical"
            initialValues={{ type: 'OTHER', cost: '0.00' }}
            onFinish={async (values) => {
              if (busy) return;
              if (!organizations.some((o) => o.id === values.branchId)) {
                setError('请重新选择所属组织');
                return;
              }
              const data = {
                name: values.name.trim(),
                type: values.type,
                code: values.code?.trim() || undefined,
                accountInfo: values.accountInfo?.trim() || undefined,
                cost: values.cost,
                branchId: values.branchId,
              };
              const body = JSON.stringify(data);
              if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
              setBusy(true);
              setError('');
              try {
                const result = await channelApi.create({ ...data, idempotencyKey: attempt.current!.key });
                if (alive.current) navigate('/channels/' + result.data.id + suffix);
              } catch (e) {
                if (alive.current) setError(requestErrorMessage(e));
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            <Form.Item name="workspaceId" label="工作区" rules={[{ required: true }]}>
              <Select
                onChange={() => form.setFieldValue('branchId', undefined)}
                options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
              />
            </Form.Item>
            <Form.Item name="branchId" label="所属组织" rules={[{ required: true }]}>
              <Select
                disabled={!workspaceId}
                options={organizations.map((o) => ({ value: o.id, label: o.name }))}
              />
            </Form.Item>
            <Form.Item name="name" label="渠道名称" rules={[{ required: true, whitespace: true }]}>
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="code" label="渠道编号">
              <Input maxLength={100} placeholder="留空自动生成" />
            </Form.Item>
            <Form.Item name="type" label="渠道类型" rules={[{ required: true }]}>
              <Select options={channelTypes} />
            </Form.Item>
            <Form.Item name="cost" label="渠道成本" rules={[{ required: true }]}>
              <InputNumber stringMode precision={2} min="0" />
            </Form.Item>
            <Form.Item name="accountInfo" label="渠道说明">
              <Input.TextArea maxLength={2000} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              保存渠道
            </Button>
          </Form>
        </Card>
      )}
    </div>
  );
}
