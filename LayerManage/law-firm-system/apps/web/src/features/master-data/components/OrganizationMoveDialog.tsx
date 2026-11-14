import { Form, Select } from 'antd';
import Modal from '@/components/DraggableModal';
import { useEffect } from 'react';
import type { OrganizationNode } from '../types';
import { allowedChildTypes } from '../form-rules';

function options(nodes: OrganizationNode[], organization: OrganizationNode | null): { value: string; label: string }[] {
  if (!organization) return [];
  return nodes.flatMap(node => {
    if (node.path === organization.path || node.path.startsWith(`${organization.path}/`)) return [];
    const current = node.status === 'ENABLED' && allowedChildTypes(node.type).includes(organization.type)
      ? [{ value: node.id, label: `${'　'.repeat(node.level)}${node.name}` }] : [];
    return [...current, ...options(node.children, organization)];
  });
}
export default function OrganizationMoveDialog({ open, organization, tree, submitting, onCancel, onSubmit }: { open: boolean; organization: OrganizationNode | null; tree: OrganizationNode[]; submitting: boolean; onCancel: () => void; onSubmit: (parentId: string) => Promise<void> }) {
  const [form] = Form.useForm<{ parentId: string }>();
  useEffect(() => { if (open) form.resetFields(); }, [form, open]);
  return <Modal title="移动组织" open={open} confirmLoading={submitting} onCancel={onCancel} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={({ parentId }) => onSubmit(parentId)}>
      <Form.Item name="parentId" label="新的上级组织" rules={[{ required: true, message: '请选择符合层级要求的上级组织' }]}><Select showSearch optionFilterProp="label" options={options(tree, organization)} /></Form.Item>
    </Form>
  </Modal>;
}
