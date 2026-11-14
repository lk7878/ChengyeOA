import Modal from '@/components/DraggableModal';
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, List, Select } from 'antd';
import { Link } from 'react-router';
import { get, post, errorMessage } from '@/features/workspaces/api';
interface Gap {
  id: string;
  name: string;
  code: string;
  createdBy: string | null;
  branchId: string | null;
  version: number;
}
interface Gaps {
  rows: Gap[];
  total: number;
  pageSize: number;
  canRepair: boolean;
  organizations: { id: string; name: string }[];
  users: { id: string; name: string }[];
}
export default function ChannelIdentityGaps() {
  const [data, setData] = useState<Gaps>();
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false),
    [row, setRow] = useState<Gap>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = () =>
      get<Gaps>('/channels/identity-gaps?page=' + page)
        .then((result) => {
          if (active) {
            setData(result);
            setError('');
          }
        })
        .catch((e) => {
          if (active) {
            setData(undefined);
            setRow(undefined);
            setError(errorMessage(e));
          }
        });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.clearInterval(timer);
      active = false;
    };
  }, [open, page, revision]);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          setRevision((v) => v + 1);
        }}
      >
        待补录渠道
      </Button>
      <Modal
        title="待补录渠道"
        open={open}
        onCancel={() => {
          if (!busy) {
            setOpen(false);
            setRow(undefined);
          }
        }}
        footer={null}
        width={760}
      >
        <p>只列出创建人或组织缺失的渠道。请核对资料后填写真实归属；组织明确后才会进入对应工作表。</p>
        {error && (
          <Alert
            type="error"
            title={error}
            action={<Button onClick={() => setRevision((v) => v + 1)}>重试</Button>}
          />
        )}
        <List
          loading={!data && !error}
          dataSource={data?.rows}
          locale={{ emptyText: '没有待补录渠道' }}
          pagination={{ current: page, pageSize: 20, total: data?.total, onChange: setPage }}
          renderItem={(item) => (
            <List.Item
              actions={
                data?.canRepair
                  ? [
                      <Button
                        key="repair"
                        onClick={() => {
                          setRow(item);
                          form.resetFields();
                        }}
                      >
                        补录
                      </Button>,
                    ]
                  : []
              }
            >
              <Link to={'/channels/' + item.id}>
                {item.code} · {item.name}
              </Link>
              <span>
                {!item.createdBy ? '缺创建人 ' : ''}
                {!item.branchId ? '缺组织' : ''}
              </span>
            </List.Item>
          )}
        />
        {row && data?.canRepair && (
          <Form
            form={form}
            layout="vertical"
            disabled={busy}
            onFinish={async (values) => {
              setBusy(true);
              try {
                await post('/channels/' + row.id + '/identity', { ...values, version: row.version });
                setRow(undefined);
                setRevision((v) => v + 1);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>补录：{row.name}</h3>
            {!row.createdBy && (
              <Form.Item name="createdBy" label="确认创建人" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={data?.users.map((user) => ({ value: user.id, label: user.name }))}
                />
              </Form.Item>
            )}
            {!row.branchId && (
              <Form.Item name="branchId" label="确认所属组织" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={data?.organizations.map((org) => ({ value: org.id, label: org.name }))}
                />
              </Form.Item>
            )}
            <Form.Item name="reason" label="补录依据" rules={[{ required: true, whitespace: true }]}>
              <Input.TextArea maxLength={1000} />
            </Form.Item>
            <p>
              候选最多 500
              项；具有全量渠道管理及账户、组织读取权限才可以补录。已明确的创建人和组织不能在这里修改。
            </p>
            <Button type="primary" htmlType="submit" loading={busy}>
              保存归属并记录审计
            </Button>
          </Form>
        )}
      </Modal>
    </>
  );
}
