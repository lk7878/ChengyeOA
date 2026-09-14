import { Form, Select } from 'antd';
import Modal from '@/components/DraggableModal';
import type { FormInstance } from 'antd';
import type { AssignmentType } from '../types';
import type { SelectOption } from './EmployeeForm';

interface Props {
  open: boolean;
  title: string;
  form: FormInstance;
  organizations: SelectOption[];
  positions: SelectOption[];
  allowType?: boolean;
  submitting?: boolean;
  onOrganizationChange: (id: string) => void;
  onCancel: () => void;
  onSubmit: (values: { organizationId: string; positionId: string; assignmentType?: AssignmentType }) => void;
}

export default function AssignmentDialog(props: Props) {
  return <Modal title={props.title} open={props.open} confirmLoading={props.submitting} onCancel={props.onCancel} onOk={() => props.form.submit()} destroyOnHidden>
    <Form form={props.form} layout="vertical" onFinish={props.onSubmit}>
      <Form.Item name="organizationId" label="组织" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={props.organizations} onChange={props.onOrganizationChange} /></Form.Item>
      <Form.Item name="positionId" label="岗位" rules={[{ required: true }]}><Select showSearch options={props.positions} /></Form.Item>
      {props.allowType && <Form.Item name="assignmentType" label="任职类型" initialValue="SECONDARY" rules={[{ required: true }]}><Select options={[{ value: 'SECONDARY', label: '兼任' }, { value: 'ACTING', label: '代理' }]} /></Form.Item>}
    </Form>
  </Modal>;
}
