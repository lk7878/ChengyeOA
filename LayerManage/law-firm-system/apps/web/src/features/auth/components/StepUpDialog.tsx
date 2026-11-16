import { useState } from 'react';
import { Alert, Button, Input, Typography } from 'antd';
import Modal from '@/components/DraggableModal';
import type { StepUpPurpose } from '../types';
import type { StepUpReadiness } from '../useStepUp';

export interface StepUpDialogProps {
  open: boolean;
  purpose: StepUpPurpose;
  impact: string;
  loading: boolean;
  error?: string | null;
  readiness?: StepUpReadiness;
  onRetry?: () => void;
  onCancel: () => void;
  onVerify: (code: string) => void | Promise<void>;
}

export default function StepUpDialog({ open, ...props }: StepUpDialogProps) {
  if (!open) return null;
  return <OpenStepUpDialog {...props} />;
}

function OpenStepUpDialog({
  purpose,
  impact,
  loading,
  error,
  onCancel,
  onVerify,
  readiness = 'READY',
  onRetry,
}: Omit<StepUpDialogProps, 'open'>) {
  const [code, setCode] = useState('');
  void purpose;

  return (
    <Modal
      open
      title="再次验证身份"
      zIndex={2000}
      okText="验证并继续"
      cancelText="取消"
      okButtonProps={{
        disabled: readiness !== 'READY' || loading || !/^\d{6}$/.test(code),
        'aria-label': '验证并继续',
      }}
      cancelButtonProps={{ disabled: loading }}
      confirmLoading={loading}
      closable={!loading}
      keyboard={!loading}
      mask={{ closable: !loading }}
      onCancel={onCancel}
      onOk={() => {
        if (readiness === 'READY' && !loading && /^\d{6}$/.test(code)) void onVerify(code);
      }}
      destroyOnHidden
    >
      <Typography.Paragraph>此操作影响：{impact}</Typography.Paragraph>
      <Typography.Paragraph>
        请验证当前登录的管理员账号，不是正在被授权的新账号。验证码来自管理员绑定的手机身份验证器，不会通过短信发送。
      </Typography.Paragraph>
      {readiness === 'CHECKING' && (
        <Typography.Paragraph role="status">正在检查账号验证状态…</Typography.Paragraph>
      )}
      {readiness === 'ENROLLMENT_REQUIRED' && (
        <Alert
          type="warning"
          showIcon
          title="当前账号尚未绑定身份验证器"
          description={
            <>
              请先进入<a href="/security/account">账号安全</a>
              ，点击“绑定身份验证器”，用手机身份验证器扫码绑定，完成后返回本单据重新审批。
            </>
          }
        />
      )}
      {readiness === 'LOGIN_REQUIRED' && (
        <Alert
          type="warning"
          showIcon
          title="当前登录尚未完成多因素验证"
          description={
            <>
              请退出账号后重新登录，并输入验证器中的验证码，再返回单据审批。
              <a href="/security/account">查看账号安全设置</a>
            </>
          }
        />
      )}
      {readiness === 'READY' && (
        <Typography.Paragraph type="secondary">
          打开身份验证器中本 OA
          账号，输入当前六位动态码。刚用于登录或审批的验证码不能重复使用，请等待下一组生成。
        </Typography.Paragraph>
      )}
      {error && <Alert role="alert" type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      {readiness !== 'READY' && readiness !== 'CHECKING' && onRetry && (
        <Button onClick={onRetry}>重新检查验证状态</Button>
      )}
      {readiness === 'READY' && (
        <Input
          aria-label="当前六位验证码"
          placeholder="输入手机身份验证器中的六位动态码"
          disabled={loading}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          onPressEnter={() => {
            if (/^\d{6}$/.test(code) && !loading) void onVerify(code);
          }}
        />
      )}
    </Modal>
  );
}
