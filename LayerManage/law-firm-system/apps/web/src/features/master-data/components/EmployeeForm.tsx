import { Form, Input, Select } from 'antd';
import type { FormInstance } from 'antd';
import { employeeNoRules, normalizeCode, textRules } from '../form-rules';
import { employeeTypeOptions } from '@/locales/employee-types';

export interface SelectOption { value: string; label: string }

interface Props {
  form: FormInstance;
  editing?: boolean;
  organizations: SelectOption[];
  positions: SelectOption[];
  onOrganizationChange: (organizationId: string) => void;
}

export default function EmployeeForm({ form, editing = false, organizations, positions, onOrganizationChange }: Props) {
  const primaryOrganizationId = Form.useWatch('primaryOrganizationId', form);
  return <Form form={form} layout="vertical">
    {!editing && <Form.Item name="employeeNo" label="员工工号" normalize={normalizeCode} rules={employeeNoRules} extra="2–32 位字母、数字、下划线或短横线，例如 EMP-001；在职员工工号唯一，办理离职后可供新员工使用"><Input maxLength={32} /></Form.Item>}
    <Form.Item name="name" label="姓名" rules={textRules('姓名')}><Input maxLength={100} /></Form.Item>
    <Form.Item name="phone" label="手机号" rules={textRules('手机号', 5, 30)}><Input autoComplete="off" maxLength={30} /></Form.Item>
    <Form.Item name="email" label="邮箱" rules={[...textRules('邮箱', 0, 254, false), { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, transform: value => typeof value === 'string' ? value.trim() : value, message: '请输入有效的邮箱地址' }]}><Input autoComplete="off" maxLength={254} /></Form.Item>
    <Form.Item name="idCard" label="身份证号" rules={textRules('身份证号', 0, 100, false)}><Input autoComplete="off" maxLength={100} /></Form.Item>
    <Form.Item name="licenseNo" label="执业证号" rules={textRules('执业证号', 0, 100, false)}><Input autoComplete="off" maxLength={100} /></Form.Item>
    <Form.Item name="employeeType" label="人员类型" rules={[{ required: true }]}><Select options={employeeTypeOptions} /></Form.Item>
    <Form.Item name="professionalDirections" label="专业方向" rules={[{ validator: async (_, values: string[] | undefined) => {
      if (!values) return;
      const normalized = values.map(value => value.trim());
      if (values.length > 20 || normalized.some(value => !value || value.length > 100) || new Set(normalized).size !== normalized.length) throw new Error('最多填写 20 个不重复的专业方向，每项为 1–100 个字符');
    } }]}><Select mode="tags" tokenSeparators={[',']} placeholder="输入专业方向后回车" /></Form.Item>
    {!editing && <>
      <Form.Item name="entryDate" label="入职日期" rules={[{ required: true }]}><Input type="date" /></Form.Item>
      <Form.Item name="primaryOrganizationId" label="主组织" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={organizations} onChange={onOrganizationChange} /></Form.Item>
      <Form.Item name="primaryPositionId" label="主岗位" rules={[{ required: true }]}><Select showSearch disabled={!primaryOrganizationId} options={positions} /></Form.Item>
    </>}
  </Form>;
}
