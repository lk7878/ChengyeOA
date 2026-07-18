import { Form, Modal, Select } from 'antd';
import { useEffect } from 'react';
import type { OrganizationNode } from '../types';

function options(nodes: OrganizationNode[], excludedPath: string): { value: string; label: string }[] {
  return nodes.flatMap(node => node.path.startsWith(excludedPath) ? [] : [{ value: node.id, label: `${'　'.repeat(node.level)}${node.name}` }, ...options(node.children, excludedPath)]);
}
export default function OrganizationMoveDialog({ open, organization, tree, submitting, onCancel, onSubmit }: { open: boolean; organization: OrganizationNode | null; tree: OrganizationNode[]; submitting: boolean; onCancel: () => void; onSubmit: (parentId: string) => Promise<void> }) {
  const [form] = Form.useForm<{ parentId: string }>();
  useEffect(() => { if (open) form.resetFields(); }, [form, open]);
  return <Modal title="移动组织" open={open} confirmLoading={submitting} onCancel={onCancel} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" onFinish={({ parentId }) => onSubmit(parentId)}>
      <Form.Item name="parentId" label="新的上级组织" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={options(tree, organization?.path ?? '')} /></Form.Item>
    </Form>
  </Modal>;
}
