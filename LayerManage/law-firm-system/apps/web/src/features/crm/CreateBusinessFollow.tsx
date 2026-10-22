import { useEffect, useRef, useState } from 'react';
import { Alert, DatePicker, Form, Input, Select } from 'antd';
import Modal from '@/components/DraggableModal';
import { errorMessage, get, post } from '../workspaces/api';

export default function CreateBusinessFollow({
  tableId,
  allowedFields,
  onCancel,
  onCreated,
}: {
  tableId: string;
  allowedFields: string[];
  onCancel(): void;
  onCreated(id: string): void;
}) {
  const [form] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [leads, setLeads] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ body: string; key: string } | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        get<{ leads: { id: string; name: string }[] }>(
          '/tables/' + tableId + '/follow-leads?keyword=' + encodeURIComponent(keyword),
        )
          .then((result) => {
            if (active) {
              setLeads(result.leads);
              setError('');
            }
          })
          .catch((e) => {
            if (active) {
              setLeads([]);
              setError(errorMessage(e));
            }
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      keyword ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tableId, keyword]);
  return (
    <Modal
      title="新增跟进"
      open
      onCancel={onCancel}
      okText="保存跟进"
      confirmLoading={busy}
      onOk={async () => {
        if (busy) return;
        try {
          const values = await form.validateFields();
          const body = Object.fromEntries(
            Object.entries({ ...values, nextTime: values.nextTime?.toISOString() }).filter(
              ([, value]) => value != null && value !== '',
            ),
          );
          const fingerprint = JSON.stringify(body);
          if (!attempt.current || attempt.current.body !== fingerprint)
            attempt.current = { body: fingerprint, key: crypto.randomUUID() };
          setBusy(true);
          setError('');
          const created = await post<{ id: string }>(
            '/tables/' + tableId + '/business-records',
            body,
            attempt.current.key,
          );
          if (mounted.current) onCreated(created.id);
        } catch (e) {
          if (mounted.current && !(e as { errorFields?: unknown }).errorFields) setError(errorMessage(e));
        } finally {
          if (mounted.current) setBusy(false);
        }
      }}
    >
      {error && <Alert type="error" title={error} />}
      <Form form={form} layout="vertical" initialValues={{ type: 'PHONE' }}>
        <Form.Item name="leadId" label="关联线索" rules={[{ required: true, message: '请选择关联线索' }]}>
          <Select
            showSearch={{ filterOption: false, onSearch: setKeyword }}
            loading={loading}
            placeholder="搜索线索编号或名称"
            options={leads.map((lead) => ({ value: lead.id, label: lead.name }))}
            notFoundContent={loading ? '正在加载' : '没有可跟进的线索，请检查线索归属和权限'}
          />
        </Form.Item>
        <Form.Item name="type" label="跟进方式" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'PHONE', label: '电话' },
              { value: 'WECHAT', label: '微信' },
              { value: 'VISIT', label: '面谈' },
              { value: 'ONLINE', label: '线上会议' },
              { value: 'SMS', label: '短信' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="content"
          label="跟进内容"
          rules={[{ required: true, whitespace: true, message: '请填写跟进内容' }]}
        >
          <Input.TextArea rows={4} maxLength={2000} />
        </Form.Item>
        {allowedFields.includes('nextPlan') && (
          <Form.Item name="nextPlan" label="下次跟进事项">
            <Input.TextArea maxLength={500} />
          </Form.Item>
        )}
        {allowedFields.includes('nextTime') && (
          <Form.Item name="nextTime" label="下次跟进时间">
            <DatePicker showTime />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
