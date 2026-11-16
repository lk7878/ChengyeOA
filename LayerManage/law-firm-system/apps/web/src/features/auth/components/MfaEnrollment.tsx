import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Spin, Typography } from 'antd';
import QRCode from 'qrcode';
import { runtimeSession } from '../runtime-session';
import { authApi } from '@/api/auth';
import type { AuthenticatedData } from '../types';

interface Props {
  challengeToken: string;
  onAuthenticated: (data: AuthenticatedData) => void;
  onExpired: () => void;
}

export default function MfaEnrollment({ challengeToken, onAuthenticated, onExpired }: Props) {
  const [loading, setLoading] = useState(true);
  const [manualKey, setManualKey] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<AuthenticatedData | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let current = true;
    authApi.beginMfaEnrollment(challengeToken)
      .then(async response => {
        const image = await QRCode.toDataURL(response.data.otpauthUri, {
          errorCorrectionLevel: 'M', margin: 1, width: 220,
        });
        if (!current) return;
        setManualKey(response.data.manualKey);
        setQr(image);
      })
      .catch(errorValue => {
        if (!current) return;
        if (isExpired(errorValue)) onExpired();
        else setError('无法开始二次验证绑定，请重试');
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [challengeToken, onExpired]);

  const confirm = async () => {
    if (!/^\d{6}$/.test(code)) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authApi.confirmMfaEnrollment(challengeToken, code);
      if (response.data.mode !== 'AUTHENTICATED') throw new Error('AUTH_STATE_INVALID');
      runtimeSession.setAuthenticated(response.data);
      setCompleted(response.data);
    } catch (errorValue) {
      if (isExpired(errorValue)) onExpired();
      else setError('验证码无效，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (completed) {
    return (
      <div>
        <Typography.Title level={4}>请立即保存恢复码</Typography.Title>
        <Alert type="warning" showIcon title="恢复码只显示一次，请离线安全保存。" />
        <pre>{completed.recoveryCodes?.join('\n')}</pre>
        <Checkbox checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}>
          我已安全保存恢复码
        </Checkbox>
        <Button type="primary" block disabled={!acknowledged} onClick={() => onAuthenticated(completed)}>
          完成
        </Button>
      </div>
    );
  }

  return (
    <Spin spinning={loading}>
      <Typography.Title level={4}>绑定身份验证器</Typography.Title>
      <Typography.Paragraph>在手机身份验证器中添加账号，扫描下方二维码或输入密钥，再填写验证器生成的六位验证码。仅管理员高风险操作需要二次验证，登录和普通审批不需要验证码；每次验证请使用新生成的验证码。</Typography.Paragraph>
      {error && <Alert role="alert" type="error" title={error} />}
      {qr && <img src={qr} alt="身份验证器二维码" width={220} height={220} />}
      <Typography.Paragraph copyable={{ text: manualKey }}>
        手动输入密钥：<Typography.Text code>{manualKey}</Typography.Text>
      </Typography.Paragraph>
      <Input
        aria-label="六位验证码"
        inputMode="numeric"
        maxLength={6}
        value={code}
        onChange={event => setCode(event.target.value.replace(/\D/g, ''))}
      />
      <Button type="primary" block disabled={!/^\d{6}$/.test(code)} onClick={confirm}>
        确认绑定
      </Button>
    </Spin>
  );
}

function isExpired(error: unknown): boolean {
  const code = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return code === 'MFA_CHALLENGE_EXPIRED' || code === 'MFA_RATE_LIMITED';
}
