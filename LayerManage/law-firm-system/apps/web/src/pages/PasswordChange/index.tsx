import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, message, Spin } from 'antd';
import { ArrowLeftOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { usePasswordChangeStore } from '@/stores/passwordChangeStore';

interface PasswordFormValues {
  password: string;
  confirmation: string;
}

const TOKEN_ERROR_CODES = new Set([
  'TOKEN_INVALID',
  'TOKEN_TYPE_INVALID',
  'AUTHENTICATION_FAILED',
]);

function responseCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('data' in response)) return null;
  const data = response.data;
  if (typeof data !== 'object' || data === null || !('message' in data)) return null;
  return typeof data.message === 'string' ? data.message : null;
}

const PasswordChange: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const token = usePasswordChangeStore((state) => state.token);
  const expiresAt = usePasswordChangeStore((state) => state.expiresAt);
  const clearPasswordChange = usePasswordChangeStore((state) => state.clear);
  const clearSession = useAuthStore((state) => state.clearSession);
  // The form must never render from missing or expired memory state.
  // eslint-disable-next-line react-hooks/purity
  const valid = Boolean(token && expiresAt && expiresAt > Date.now());

  useEffect(() => {
    if (!valid) {
      clearPasswordChange();
      navigate('/login', { replace: true });
      return;
    }

    const delay = (expiresAt ?? 0) - Date.now();
    if (delay <= 0) {
      clearPasswordChange();
      navigate('/login', { replace: true });
      return;
    }
    const timeout = window.setTimeout(() => {
      clearPasswordChange();
      navigate('/login', { replace: true });
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [clearPasswordChange, expiresAt, navigate, valid]);

  const returnToLogin = () => {
    clearPasswordChange();
    clearSession();
    navigate('/login', { replace: true });
  };

  const onFinish = async (values: PasswordFormValues) => {
    const current = usePasswordChangeStore.getState();
    if (!current.token || !current.expiresAt || current.expiresAt <= Date.now()) {
      returnToLogin();
      message.error('登录状态已失效，请重新登录');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      await authApi.forcePasswordChange(current.token, values.password, values.confirmation);
      clearPasswordChange();
      clearSession();
      message.success('密码已更新，请重新登录');
      navigate('/login', { replace: true });
    } catch (error) {
      const code = responseCode(error);
      if (code === 'PASSWORD_INVALID') {
        setErrorMessage('新密码不符合安全要求，请重新输入');
      } else if (code === 'PASSWORD_REUSED') {
        setErrorMessage('新密码不能与初始密码相同');
      } else if (code && TOKEN_ERROR_CODES.has(code)) {
        clearPasswordChange();
        clearSession();
        message.error('登录状态已失效，请重新登录');
        navigate('/login', { replace: true });
      } else {
        setErrorMessage('密码修改失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!valid) return null;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Spin spinning={loading}>
        <Card
          title={<h2 style={{ textAlign: 'center', margin: 0 }}>修改初始密码</h2>}
          style={{ width: 'min(400px, calc(100vw - 32px))', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
        >
          <Form name="password-change" onFinish={onFinish} autoComplete="off">
            {errorMessage && (
              <Alert type="error" showIcon title={errorMessage} style={{ marginBottom: 16 }} />
            )}
            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入新密码' }]}
            >
              <Input.Password
                aria-label="新密码"
                prefix={<LockOutlined />}
                placeholder="新密码"
                autoComplete="new-password"
              />
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
              <Input.Password
                aria-label="确认新密码"
                prefix={<LockOutlined />}
                placeholder="确认新密码"
                autoComplete="new-password"
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 8 }}>
              <Button type="primary" htmlType="submit" block loading={loading}>
                确认修改
              </Button>
            </Form.Item>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              block
              aria-label="返回登录"
              onClick={returnToLogin}
            >
              返回登录
            </Button>
          </Form>
        </Card>
      </Spin>
    </div>
  );
};

export default PasswordChange;
