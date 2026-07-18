import { Form, Input, Select } from 'antd';
import type { FormInstance } from 'antd';
import type { SelectOption } from './EmployeeForm';

interface Props { form: FormInstance; editing?: boolean; organizations: SelectOption[] }

export default function ProfessionalTeamForm({ form, editing = false, organizations }: Props) {
  return <Form form={form} layout="vertical">
    {!editing && <Form.Item name="code" label="团队编码" rules={[{ required: true }]}><Input /></Form.Item>}
    <Form.Item name="name" label="团队名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="categoryCode" label="团队分类" rules={[{ required: true }]}><Input placeholder="输入稳定分类编码" /></Form.Item>
    <Form.Item name="homeOrganizationId" label="归属组织" rules={[{ required: true }]}><Select showSearch options={organizations} /></Form.Item>
    <Form.Item name="description" label="团队说明"><Input.TextArea rows={4} /></Form.Item>
  </Form>;
}
