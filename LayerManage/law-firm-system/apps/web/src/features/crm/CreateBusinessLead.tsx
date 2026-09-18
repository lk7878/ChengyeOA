import Modal from '@/components/DraggableModal';
import { useEffect, useRef, useState } from 'react';
import { Alert, Form, Input, InputNumber, Select } from 'antd';
import { LEAD_SOURCE_TYPES } from '@/api/types';
import { SOURCE_TYPE_META } from '@/pages/leads/meta';
import { crmNameRules, phoneRules } from './form-rules';
import { errorMessage, post } from '../workspaces/api';
export default function CreateBusinessLead({
  tableId,
  onCancel,
  onCreated,
  allowedFields = ['wechat', 'intentionLevel'],
}: {
  tableId: string;
  allowedFields?: string[];
  onCancel: () => void;
  onCreated: (id: string, duplicates: number) => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ body: string; key: string } | undefined>(undefined);
  return (
    <Modal
      title="新建线索"
      open
      onCancel={onCancel}
      confirmLoading={busy}
      okText="创建线索"
      onOk={async () => {
        try {
          const values = await form.validateFields();
          const body = Object.fromEntries(
            Object.entries(values).filter(([, value]) => value !== '' && value != null),
          );
          const fingerprint = JSON.stringify(body);
          if (!attempt.current || attempt.current.body !== fingerprint)
            attempt.current = { body: fingerprint, key: crypto.randomUUID() };
          setBusy(true);
          setError('');
          const created = await post<{ id: string; duplicates: number }>(
            '/tables/' + tableId + '/business-records',
            body,
            attempt.current.key,
          );
          if (mounted.current) onCreated(created.id, created.duplicates);
        } catch (e) {
          if (!(e as { errorFields?: unknown }).errorFields) setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Alert type="error" title={error} />}
      <p>线索归入当前工作区组织，创建后进入公海。业务记录与各入口同步。</p>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ...(allowedFields.includes('intentionLevel') ? { intentionLevel: 3 } : {}),
          sourceType: 'MANUAL',
        }}
      >
        <Form.Item name="name" label="姓名" rules={crmNameRules}>
          <Input aria-label="线索姓名" maxLength={100} />
        </Form.Item>
        <Form.Item name="phone" label="联系电话" rules={phoneRules()}>
          <Input aria-label="线索联系电话" maxLength={30} />
        </Form.Item>
        {allowedFields.includes('wechat') && (
          <Form.Item name="wechat" label="微信">
            <Input maxLength={100} />
          </Form.Item>
        )}
        {allowedFields.includes('intentionLevel') && (
          <Form.Item name="intentionLevel" label="意向等级">
            <InputNumber min={1} max={5} precision={0} />
          </Form.Item>
        )}
        <Form.Item name="sourceType" label="来源类型">
          <Select options={LEAD_SOURCE_TYPES.map((value) => ({ value, label: SOURCE_TYPE_META[value] }))} />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Input maxLength={200} placeholder="多个标签用逗号分隔" />
        </Form.Item>
        <Form.Item name="sourceDetail" label="来源说明">
          <Input.TextArea maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
