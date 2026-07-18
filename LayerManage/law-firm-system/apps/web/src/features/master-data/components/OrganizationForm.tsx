import { Form, Input, InputNumber, Modal, Select } from 'antd';
import { useEffect } from 'react';
import type { CreateOrganizationInput, OrganizationNode, UpdateOrganizationInput } from '../types';

type Values = { code: string; name: string; type: CreateOrganizationInput['type']; sort?: number };

export default function OrganizationForm({ open, parent, editing, submitting, onCancel, onSubmit }: {
  open: boolean; parent: OrganizationNode | null; editing: OrganizationNode | null; submitting: boolean;
  onCancel: () => void; onSubmit: (value: CreateOrganizationInput | UpdateOrganizationInput) => Promise<void>;
}) {
  const [form] = Form.useForm<Values>();
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(editing ? { code: editing.code, name: editing.name, type: editing.type as Values['type'], sort: editing.sort } : { code: '', name: '', type: 'DEPARTMENT', sort: 0 });
  }, [editing, form, open]);
  return <Modal title={editing ? '编辑组织' : '新增下级组织'} open={open} confirmLoading={submitting} onCancel={onCancel} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={value => onSubmit(editing ? { name: value.name, sort: value.sort, version: editing.version } : { ...value, parentId: parent!.id })}>
      {!editing && <Form.Item label="上级组织"><Input value={parent?.name} disabled /></Form.Item>}
      <Form.Item name="code" label="组织编码" rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item>
      <Form.Item name="name" label="组织名称" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="type" label="组织类型" rules={[{ required: true }]}><Select disabled={Boolean(editing)} options={[
        { value: 'HQ_CENTER', label: '总部中心' }, { value: 'DEPARTMENT', label: '部门' }, { value: 'BRANCH', label: '分所' }, { value: 'GROUP', label: '工作组' },
      ]} /></Form.Item>
      <Form.Item name="sort" label="排序"><InputNumber min={0} precision={0} /></Form.Item>
    </Form>
  </Modal>;
}
