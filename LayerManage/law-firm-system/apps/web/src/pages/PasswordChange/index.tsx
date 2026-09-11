import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, message, Spin } from 'antd';
import { ArrowLeftOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { authApi } from '@/api/auth';
import { useChallengeStore } from '@/features/auth/challengeStore';
import type { LoginData } from '@/features/auth/types';
import { useAuthStore } from '@/stores/authStore';

interface PasswordFormValues {
  password: string;
  confirmation: string;
}

const TOKEN_ERROR_CODES = new Set([
  'TOKEN_INVALID',
  'TOKEN_TYPE_INVALID',
  'AUTHENTICATION_FAILED',
  'PASSWORD_CHANGE_CHALLENGE_EXPIRED',
]);

export default function PasswordChange() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const leaving = useRef(false);
  const challenge = useChallengeStore();
  const challengeExpiresAt = challenge.expiresAt;
  const clearChallenge = challenge.clear;
  const setAuthenticated = useAuthStore(state => state.setAuthenticated);
  const clearSession = useAuthStore(state => state.clearSession);
  const valid = challenge.isCurrent('PASSWORD_CHANGE');

  useEffect(() => {
    if (leaving.current) return;
    if (!valid) {
      clearChallenge();
      navigate('/login', { replace: true });
      return;
    }
    const delay = (challengeExpiresAt ?? 0) - Date.now();
    const timeout = window.setTimeout(() => {
      leaving.current = true;
      clearChallenge();
      clearSession();
      navigate('/login', { replace: true });
    }, Math.max(0, delay));
    return () => window.clearTimeout(timeout);
  }, [challengeExpiresAt, clearChallenge, clearSession, navigate, valid]);

  const returnToLogin = (expired = false) => {
    leaving.current = true;
    challenge.clear();
    clearSession();
    if (expired) message.error('登录状态已失效，请重新登录');
    navigate('/login', { replace: true });
  };

  const dispatch = (data: LoginData) => {
    if (data.mode === 'AUTHENTICATED') {
      leaving.current = true;
      challenge.clear();
      setAuthenticated(data);
      message.success('密码已更新');
      navigate('/', { replace: true });
      return;
    }
    if (data.mode === 'MFA_ENROLLMENT_REQUIRED') {
      leaving.current = true;
      challenge.begin('MFA_ENROLLMENT', data.challengeToken, data.expiresIn);
      navigate('/login', { replace: true });
      return;
    }
    if (data.mode === 'MFA_CHALLENGE_REQUIRED') {
      leaving.current = true;
      challenge.begin('MFA_VERIFY', data.challengeToken, data.expiresIn);
      navigate('/login', { replace: true });
      return;
    }
    challenge.begin('PASSWORD_CHANGE', data.challengeToken, data.expiresIn);
    setErrorMessage('密码修改未完成，请重试');
  };

  const onFinish = async (values: PasswordFormValues) => {
    const current = useChallengeStore.getState();
    if (!current.isCurrent('PASSWORD_CHANGE') || !current.token) {
      returnToLogin(true);
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await authApi.forcePasswordChange(current.token, values.password, values.confirmation);
      dispatch(response.data);
    } catch (error) {
      const code = responseCode(error);
      if (code === 'PASSWORD_INVALID') setErrorMessage('新密码不符合安全要求，请重新输入');
      else if (code === 'PASSWORD_REUSED') setErrorMessage('新密码不能与初始密码相同');
      else if (code && TOKEN_ERROR_CODES.has(code)) returnToLogin(true);
      else setErrorMessage('密码修改失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (!valid) return null;

  return (
    <div style={pageStyle}>
      <Spin spinning={loading}>
        <Card
          title={<h2 style={{ textAlign: 'center', margin: 0 }}>修改初始密码</h2>}
          style={{ width: 'min(400px, calc(100vw - 32px))', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
        >
          <Form name="password-change" onFinish={onFinish} autoComplete="off">
            {errorMessage && <Alert role="alert" type="error" showIcon title={errorMessage} style={{ marginBottom: 16 }} />}
            <Form.Item name="password" rules={[{ required: true, message: '请输入新密码' }]}>
              <Input.Password aria-label="新密码" prefix={<LockOutlined />} placeholder="新密码" autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirmation"
              dependencies={['password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password aria-label="确认新密码" prefix={<LockOutlined />} placeholder="确认新密码" autoComplete="new-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 8 }}>
              <Button aria-label="确认修改" type="primary" htmlType="submit" block loading={loading}>确认修改</Button>
            </Form.Item>
            <Button type="text" icon={<ArrowLeftOutlined />} block aria-label="返回登录" onClick={() => returnToLogin()}>
              返回登录
            </Button>
          </Form>
        </Card>
      </Spin>
    </div>
  );
}

function responseCode(error: unknown): string | null {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? null;
}

const pageStyle = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
} as const;
