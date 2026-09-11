import { Form, Input, Select } from 'antd';
import type { FormInstance } from 'antd';
import type { SelectOption } from './EmployeeForm';
import { CODE_HELP, codeRules, normalizeCode, textRules } from '../form-rules';

interface Props { form: FormInstance; editing?: boolean; organizations: SelectOption[] }

export default function ProfessionalTeamForm({ form, editing = false, organizations }: Props) {
  return <Form form={form} layout="vertical">
    {!editing && <Form.Item name="code" label="团队编码" normalize={normalizeCode} extra={CODE_HELP} rules={codeRules('团队编码')}><Input maxLength={32} placeholder="例如 TEAM_001" /></Form.Item>}
    <Form.Item name="name" label="团队名称" rules={textRules('团队名称')}><Input maxLength={100} /></Form.Item>
    <Form.Item name="categoryCode" label="团队分类" rules={textRules('团队分类', 1, 100)}><Input maxLength={100} placeholder="例如：民商事、刑事辩护、劳动争议" /></Form.Item>
    <Form.Item name="homeOrganizationId" label="归属组织" rules={[{ required: true }]}><Select showSearch options={organizations} /></Form.Item>
    <Form.Item name="description" label="团队说明" rules={textRules('团队说明', 0, 2000, false)}><Input.TextArea rows={4} maxLength={2000} showCount /></Form.Item>
  </Form>;
}
