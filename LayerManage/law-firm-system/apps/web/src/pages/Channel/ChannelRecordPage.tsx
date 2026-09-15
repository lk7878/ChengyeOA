import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
} from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { channelApi } from '@/api/organization';
import { requestErrorMessage } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
import type { Channel, ChannelStatistics } from '@/types';
import { channelTypes } from './channel-types';

export default function ChannelRecordPage() {
  const { id = '' } = useParams();
  return <ChannelRecord key={id} id={id} />;
}
function ChannelRecord({ id }: { id: string }) {
  const navigate = useNavigate(),
    [params] = useSearchParams(),
    has = useAuthStore((s) => s.hasPermission);
  const [row, setRow] = useState<Channel>(),
    [stats, setStats] = useState<ChannelStatistics>(),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [draftVersion, setDraftVersion] = useState<number>();
  const [form] = Form.useForm();
  const alive = useRef(true),
    sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const data = (await channelApi.statistics(id)).data;
      if (alive.current && seq === sequence.current) {
        setRow(data.channel);
        setStats(data);
        setError('');
      }
    } catch (e) {
      if (alive.current && seq === sequence.current) {
        setRow(undefined);
        setStats(undefined);
        setDraftVersion(undefined);
        setError(requestErrorMessage(e));
      }
    } finally {
      if (alive.current && seq === sequence.current) setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => {
      if (alive.current) void refresh();
    });
    const counter = sequence;
    const timer = window.setInterval(() => void refresh(), 5000),
      focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      alive.current = false;
      counter.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  const back = '/channels' + (params.size ? '?' + params.toString() : '');
  return (
    <div className="unified-area-page">
      <Link to={back}>返回渠道工作表</Link>
      <h1>{row?.name || '渠道详情'}</h1>
      {error && (
        <Alert type="error" title={error} action={<Button onClick={() => void refresh()}>重新加载</Button>} />
      )}
      {loading && <Spin />}
      {row && (
        <>
          <Space wrap style={{ marginBottom: 16 }}>
            <Button onClick={() => void refresh()}>刷新渠道</Button>
            {has('channel.update') && (
              <Button
                onClick={() => {
                  form.setFieldsValue({
                    name: row.name,
                    accountInfo: row.accountInfo,
                    cost: row.cost ?? '0.00',
                    status: row.status,
                  });
                  setDraftVersion(row.version);
                }}
              >
                编辑渠道
              </Button>
            )}
            {has('channel.delete') && (
              <Popconfirm
                title="删除此渠道？已有关联业务的渠道无法删除。"
                onConfirm={async () => {
                  if (busy) return;
                  setBusy(true);
                  try {
                    await channelApi.delete(id, row.version);
                    if (alive.current) navigate(back);
                  } catch (e) {
                    if (alive.current) setError(requestErrorMessage(e));
                  } finally {
                    if (alive.current) setBusy(false);
                  }
                }}
              >
                <Button danger loading={busy}>
                  删除渠道
                </Button>
              </Popconfirm>
            )}
            <BusinessTableLinks recordId={id} source="CHANNELS" />
          </Space>
          <Card>
            <Descriptions
              column={{ xs: 1, md: 2 }}
              items={[
                { key: 'code', label: '渠道编号', children: row.code },
                {
                  key: 'type',
                  label: '渠道类型',
                  children: channelTypes.find((t) => t.value === row.type)?.label || row.type,
                },
                { key: 'cost', label: '渠道成本', children: row.cost == null ? '未登记' : '¥ ' + row.cost },
                { key: 'status', label: '状态', children: row.status === 'ENABLED' ? '启用' : '停用' },
                { key: 'info', label: '渠道说明', children: row.accountInfo || '未填写' },
                { key: 'leads', label: '可见线索', children: stats?.totalLeads ?? '不可用' },
                { key: 'converted', label: '已转化线索', children: stats?.convertedLeads ?? '不可用' },
                { key: 'rate', label: '转化率', children: stats?.conversionRate ?? '不可用' },
              ]}
            />
          </Card>
          {row.branchId == null && (
            <Alert
              type="warning"
              title="此历史渠道尚未登记所属组织"
              description="补齐归属后可在相应工作区中使用。"
            />
          )}
          <Modal
            title="编辑渠道"
            open={draftVersion !== undefined}
            destroyOnHidden
            onCancel={() => setDraftVersion(undefined)}
            confirmLoading={busy}
            okText="保存渠道"
            onOk={async () => {
              if (busy || draftVersion === undefined) return;
              try {
                const values = await form.validateFields();
                setBusy(true);
                const result = await channelApi.update(id, { ...values, version: draftVersion });
                if (alive.current) {
                  setRow(result.data);
                  setDraftVersion(undefined);
                  void refresh();
                }
              } catch (e) {
                if (alive.current && !(e as { errorFields?: unknown }).errorFields)
                  setError(requestErrorMessage(e));
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            {draftVersion !== undefined && row.version !== draftVersion && (
              <Alert
                type="warning"
                title="渠道已被他人修改，请核对最新详情与当前草稿"
                action={<Button onClick={() => setDraftVersion(row.version)}>已核对，采用最新版本</Button>}
              />
            )}
            <Form form={form} layout="vertical">
              <Form.Item name="name" label="渠道名称" rules={[{ required: true, whitespace: true }]}>
                <Input maxLength={100} />
              </Form.Item>
              <Form.Item name="cost" label="渠道成本" rules={[{ required: true }]}>
                <InputNumber stringMode precision={2} min="0" />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select
                  options={[
                    { value: 'ENABLED', label: '启用' },
                    { value: 'DISABLED', label: '停用' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="accountInfo" label="渠道说明">
                <Input.TextArea maxLength={2000} />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </div>
  );
}
