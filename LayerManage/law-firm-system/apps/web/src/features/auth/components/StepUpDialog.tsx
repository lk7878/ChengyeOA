import { useState } from 'react';
import { Alert, Input, Modal, Typography } from 'antd';
import type { StepUpPurpose } from '../types';

export interface StepUpDialogProps {
  open: boolean;
  purpose: StepUpPurpose;
  impact: string;
  loading: boolean;
  error?: string | null;
  onCancel: () => void;
  onVerify: (code: string) => void | Promise<void>;
}

export default function StepUpDialog({
  open, purpose, impact, loading, error, onCancel, onVerify,
}: StepUpDialogProps) {
  if (!open) return null;
  return <OpenStepUpDialog purpose={purpose} impact={impact} loading={loading} error={error} onCancel={onCancel} onVerify={onVerify} />;
}

function OpenStepUpDialog({
  purpose, impact, loading, error, onCancel, onVerify,
}: Omit<StepUpDialogProps, 'open'>) {
  const [code, setCode] = useState('');
  void purpose;

  return (
    <Modal
      open
      title="再次验证身份"
      okText="验证并继续"
      cancelText="取消"
      okButtonProps={{ disabled: !/^\d{6}$/.test(code), 'aria-label': '验证并继续' }}
      cancelButtonProps={{ disabled: loading }}
      confirmLoading={loading}
      closable={!loading}
      keyboard={!loading}
      mask={{ closable: !loading }}
      onCancel={onCancel}
      onOk={() => onVerify(code)}
      destroyOnHidden
    >
      <Typography.Paragraph>此操作影响：{impact}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">请输入身份验证器当前显示的六位验证码。</Typography.Paragraph>
      {error && <Alert role="alert" type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Input
        aria-label="当前六位验证码"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={event => setCode(event.target.value.replace(/\D/g, ''))}
        onPressEnter={() => { if (/^\d{6}$/.test(code) && !loading) void onVerify(code); }}
      />
    </Modal>
  );
}
