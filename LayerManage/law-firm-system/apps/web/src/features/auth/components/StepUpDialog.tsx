import { useCallback, useState } from 'react';
import { authApi } from '@/api/auth';
import { runtimeSession } from '../runtime-session';
import type { AuthenticatedData } from '../types';
import MfaEnrollment from './MfaEnrollment';
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
  const [enrollment, setEnrollment] = useState<string | null>(null);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const complete = useCallback((data: AuthenticatedData) => {
    runtimeSession.setAuthenticated(data); setEnrollment(null); setCode(''); onRetry?.();
  }, [onRetry]);
  const expired = useCallback(() => { setEnrollment(null); setEnrollmentError('绑定已过期，请重新开始'); }, []);
  const start = async () => {
    setEnrollmentError(null);
    try { setEnrollment((await authApi.startMfaEnrollment()).data.challengeToken); }
    catch { setEnrollmentError('无法开始绑定，请确认管理员权限后重试'); }
  };
  void purpose;

  return (
    <Modal
      open
      title="管理员操作二次验证"
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
      {readiness === 'ADMIN_REQUIRED' && <Alert type="info" showIcon title="此操作仅限有权限的管理员执行，请联系管理员。普通账号无需绑定验证器。" />}
      {readiness === 'ENROLLMENT_REQUIRED' && !enrollment && <>
        <Alert type="info" showIcon title="首次执行管理员高风险操作前，请绑定身份验证器。完成后将返回本次操作，原表单会保留。" />
        <Button onClick={() => void start()}>在此绑定身份验证器</Button>
        <Typography.Paragraph type="secondary">如果原验证器已丢失，请通过现有管理员恢复流程处理，不要重复新建账号。</Typography.Paragraph>
      </>}
      {enrollmentError && <Alert type="error" title={enrollmentError} />}
      {enrollment && <MfaEnrollment challengeToken={enrollment} onAuthenticated={complete} onExpired={expired} />}
      {readiness === 'READY' && (
        <Typography.Paragraph type="secondary">
          打开身份验证器中本 OA
          账号，输入当前六位动态码。刚用于绑定或其他管理操作的验证码不能重复使用，请等待下一组生成。
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
