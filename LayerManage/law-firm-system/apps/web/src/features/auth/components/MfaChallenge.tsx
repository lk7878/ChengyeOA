import { useState } from 'react';
import { Alert, Button, Input, Space, Typography } from 'antd';
import { authApi } from '@/api/auth';
import type { AuthenticatedData } from '../types';

interface Props {
  challengeToken: string;
  onAuthenticated: (data: AuthenticatedData) => void;
  onExpired: () => void;
}

export default function MfaChallenge({ challengeToken, onAuthenticated, onExpired }: Props) {
  const [kind, setKind] = useState<'TOTP' | 'RECOVERY_CODE'>('TOTP');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = kind === 'TOTP' ? /^\d{6}$/.test(code) : code.trim().length >= 8;

  const verify = async () => {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      const normalized = kind === 'TOTP' ? code : code.trim().toUpperCase();
      const response = await authApi.verifyMfa(challengeToken, { kind, code: normalized });
      if (response.data.mode !== 'AUTHENTICATED') throw new Error('AUTH_STATE_INVALID');
      onAuthenticated(response.data);
    } catch (errorValue) {
      const responseCode = (errorValue as { response?: { data?: { message?: string } } })?.response?.data?.message;
      if (responseCode === 'MFA_CHALLENGE_EXPIRED' || responseCode === 'MFA_RATE_LIMITED') onExpired();
      else setError('验证失败，请检查验证码后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Typography.Title level={4}>多因素验证</Typography.Title>
      {error && <Alert role="alert" type="error" title={error} />}
      <Input
        aria-label={kind === 'TOTP' ? '六位验证码' : '恢复码'}
        inputMode={kind === 'TOTP' ? 'numeric' : 'text'}
        maxLength={kind === 'TOTP' ? 6 : 64}
        value={code}
        onChange={event => setCode(
          kind === 'TOTP' ? event.target.value.replace(/\D/g, '') : event.target.value,
        )}
      />
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Button
          aria-label="提交 MFA 验证"
          type="primary"
          block
          loading={loading}
          disabled={!valid}
          onClick={verify}
        >
          验证
        </Button>
        <Button type="link" onClick={() => {
          setKind(current => current === 'TOTP' ? 'RECOVERY_CODE' : 'TOTP');
          setCode('');
          setError(null);
        }}>
          {kind === 'TOTP' ? '使用恢复码' : '使用身份验证器验证码'}
        </Button>
      </Space>
    </div>
  );
}
