import { Form, Input, Radio } from 'antd';
import Modal from '@/components/DraggableModal';
import type { AdminOperationSummary, GovernanceDecision } from '../types';

type Props = { operation: AdminOperationSummary | null; submitting: boolean; onClose: () => void; onSubmit: (decision: GovernanceDecision, comment?: string) => Promise<void> };
type Values = { decision: GovernanceDecision; comment?: string };

export default function ReviewDialog({ operation, submitting, onClose, onSubmit }: Props) {
  const [form] = Form.useForm<Values>();
  const postReview = operation?.status === 'PENDING_POST_REVIEW';
  return <Modal title={postReview ? '事后审核' : '治理审核'} open={Boolean(operation)} onCancel={onClose}
    okText="提交审核" cancelText="取消" confirmLoading={submitting} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" initialValues={{ decision: postReview ? 'CONFIRM' : 'APPROVE' }}
      onFinish={values => onSubmit(values.decision, values.comment?.trim() || undefined)}>
      <Form.Item label="审核结论" name="decision" rules={[{ required: true }]}>
        <Radio.Group options={postReview ? [{ value: 'CONFIRM', label: '确认无误' }, { value: 'FLAG', label: '标记异常' }] : [{ value: 'APPROVE', label: '通过' }, { value: 'REJECT', label: '驳回' }]} />
      </Form.Item>
      <Form.Item label="审核意见" name="comment" rules={[{ validator: (_, value) => {
        const currentDecision = form.getFieldValue('decision') as GovernanceDecision | undefined;
        if (currentDecision !== 'REJECT' && currentDecision !== 'FLAG') return Promise.resolve();
        return typeof value === 'string' && value.trim().length >= 10
          ? Promise.resolve()
          : Promise.reject(new Error('驳回或标记异常时请填写至少 10 个字符'));
      } }]}>
        <Input.TextArea rows={4} maxLength={1000} showCount />
      </Form.Item>
    </Form>
  </Modal>;
}
