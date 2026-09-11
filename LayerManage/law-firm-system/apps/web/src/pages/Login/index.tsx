import { useEffect, useState } from 'react';
import axios from 'axios';
import { Alert, Button, Card, Form, Input, message, Spin } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { authApi } from '@/api/auth';
import { useChallengeStore } from '@/features/auth/challengeStore';
import MfaChallenge from '@/features/auth/components/MfaChallenge';
import MfaEnrollment from '@/features/auth/components/MfaEnrollment';
import type { AuthenticatedData, LoginData } from '@/features/auth/types';
import { useAuthStore } from '@/stores/authStore';

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const challenge = useChallengeStore();
  const { kind: challengeKind, token: challengeToken, expiresAt: challengeExpiresAt, clear: clearChallenge } = challenge;
  const setAuthenticated = useAuthStore(state => state.setAuthenticated);
  const clearSession = useAuthStore(state => state.clearSession);

  useEffect(() => {
    if (!challengeToken || !challengeExpiresAt || challengeKind === 'PASSWORD_CHANGE') return;
    const delay = Math.max(0, challengeExpiresAt - Date.now());
    const timeout = window.setTimeout(() => {
      clearChallenge();
      setErrorMessage('验证已过期，请重新登录');
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [challengeKind, challengeToken, challengeExpiresAt, clearChallenge]);

  const completeAuthentication = (data: AuthenticatedData) => {
    challenge.clear();
    setAuthenticated(data);
    message.success('登录成功');
    navigate('/', { replace: true });
  };

  const expireChallenge = () => {
    challenge.clear();
    clearSession();
    setErrorMessage('验证已过期，请重新登录');
  };

  const dispatch = (data: LoginData) => {
    if (data.mode === 'AUTHENTICATED') {
      completeAuthentication(data);
    } else if (data.mode === 'PASSWORD_CHANGE_REQUIRED') {
      clearSession();
      challenge.begin('PASSWORD_CHANGE', data.challengeToken, data.expiresIn);
      navigate('/password-change');
    } else if (data.mode === 'MFA_ENROLLMENT_REQUIRED') {
      clearSession();
      challenge.begin('MFA_ENROLLMENT', data.challengeToken, data.expiresIn);
    } else {
      clearSession();
      challenge.begin('MFA_VERIFY', data.challengeToken, data.expiresIn);
    }
  };

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await authApi.login(values);
      dispatch(response.data);
    } catch (error) {
      setErrorMessage(axios.isAxiosError(error) && error.response?.status === 401
        ? '用户名或密码不正确，或账号暂时无法登录，请核对后重试'
        : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const challengeContent = challenge.isCurrent('MFA_ENROLLMENT') && challenge.token
    ? <MfaEnrollment challengeToken={challenge.token} onAuthenticated={completeAuthentication} onExpired={expireChallenge} />
    : challenge.isCurrent('MFA_VERIFY') && challenge.token
      ? <MfaChallenge challengeToken={challenge.token} onAuthenticated={completeAuthentication} onExpired={expireChallenge} />
      : null;

  return (
    <div style={pageStyle}>
      <Spin spinning={loading}>
        <Card
          title={<h2 style={{ textAlign: 'center', margin: 0 }}>律所管理系统</h2>}
          style={{ width: 'min(400px, calc(100vw - 32px))', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
        >
          {challengeContent ?? (
            <Form name="login" onFinish={onFinish} autoComplete="off">
              {errorMessage && <Alert role="alert" type="error" showIcon title={errorMessage} style={{ marginBottom: 16 }} />}
              <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input aria-label="用户名" prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password aria-label="密码" prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
              </Form.Item>
              <Form.Item>
                <Button aria-label="登录" type="primary" htmlType="submit" block loading={loading}>登录</Button>
              </Form.Item>
            </Form>
          )}
        </Card>
      </Spin>
    </div>
  );
}

const pageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
} as const;
