import { Form, Input, Select } from 'antd';
import type { FormInstance } from 'antd';

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
    {!editing && <Form.Item name="employeeNo" label="员工工号" rules={[{ required: true }]}><Input /></Form.Item>}
    <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="phone" label="手机号" rules={[{ required: true }]}><Input autoComplete="off" /></Form.Item>
    <Form.Item name="email" label="邮箱"><Input autoComplete="off" /></Form.Item>
    <Form.Item name="idCard" label="身份证号"><Input autoComplete="off" /></Form.Item>
    <Form.Item name="licenseNo" label="执业证号"><Input autoComplete="off" /></Form.Item>
    <Form.Item name="employeeType" label="人员类型" rules={[{ required: true }]}><Select options={[
      ['PARTNER', '合伙人'], ['LAWYER', '律师'], ['ASSISTANT', '助理'], ['SALES', '销转'], ['ADMIN', '行政'], ['HR', '人事'], ['FINANCE', '财务'], ['OPERATOR', '运营'], ['TECHNICAL', '技术'], ['OTHER', '其他'],
    ].map(([value, label]) => ({ value, label }))} /></Form.Item>
    <Form.Item name="professionalDirections" label="专业方向"><Select mode="tags" tokenSeparators={[',']} placeholder="输入编码后回车" /></Form.Item>
    {!editing && <>
      <Form.Item name="entryDate" label="入职日期" rules={[{ required: true }]}><Input type="date" /></Form.Item>
      <Form.Item name="primaryOrganizationId" label="主组织" rules={[{ required: true }]}><Select showSearch options={organizations} onChange={onOrganizationChange} /></Form.Item>
      <Form.Item name="primaryPositionId" label="主岗位" rules={[{ required: true }]}><Select showSearch disabled={!primaryOrganizationId} options={positions} /></Form.Item>
    </>}
  </Form>;
}
