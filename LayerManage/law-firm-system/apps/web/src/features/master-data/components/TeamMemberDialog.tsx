import { Form, Modal, Select } from 'antd';
import type { FormInstance } from 'antd';
import type { TeamMemberRole } from '../types';
import type { SelectOption } from './EmployeeForm';

interface Props { open: boolean; title: string; form: FormInstance; employees: SelectOption[]; replaceLead?: boolean; submitting?: boolean; onSearch: (keyword: string) => void; onCancel: () => void; onSubmit: (values: { employeeId: string; memberRole: TeamMemberRole }) => void }

export default function TeamMemberDialog(props: Props) {
  return <Modal title={props.title} open={props.open} confirmLoading={props.submitting} onCancel={props.onCancel} onOk={() => props.form.submit()} destroyOnHidden>
    <Form form={props.form} layout="vertical" onFinish={props.onSubmit}>
      <Form.Item name="employeeId" label="员工" rules={[{ required: true }]}><Select showSearch filterOption={false} onSearch={props.onSearch} options={props.employees} /></Form.Item>
      {!props.replaceLead && <Form.Item name="memberRole" label="团队角色" initialValue="LAWYER" rules={[{ required: true }]}><Select options={[
        ['EXPERT', '专家'], ['LAWYER', '律师'], ['ASSISTANT', '助理'], ['OPERATIONS', '运营'], ['OTHER', '其他'],
      ].map(([value, label]) => ({ value, label }))} /></Form.Item>}
    </Form>
  </Modal>;
}
