import React, { useState } from 'react';
import { Alert, Button, Form, Input, Card, message, Spin } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { usePasswordChangeStore } from '@/stores/passwordChangeStore';

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const { setToken, setUserInfo, clearSession } = useAuthStore();
  const beginPasswordChange = usePasswordChangeStore((state) => state.begin);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await authApi.login(values);
      if (res.code === 200) {
        if (res.data.mode === 'PASSWORD_CHANGE_REQUIRED') {
          clearSession();
          beginPasswordChange(res.data.passwordChangeToken, res.data.expiresIn);
          navigate('/password-change');
        } else {
          const { token, refreshToken, user } = res.data;
          setToken(token, refreshToken);
          setUserInfo(user);
          message.success('登录成功');
          navigate('/');
        }
      }
    } catch {
      setErrorMessage('登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Spin spinning={loading}>
        <Card
          title={<h2 style={{ textAlign: 'center', margin: 0 }}>律所管理系统</h2>}
          style={{ width: 'min(400px, calc(100vw - 32px))', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
        >
          <Form
            name="login"
            initialValues={{ remember: true }}
            onFinish={onFinish}
            autoComplete="off"
          >
            {errorMessage && (
              <Alert
                type="error"
                showIcon
                title={errorMessage}
                style={{ marginBottom: 16 }}
              />
            )}
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input aria-label="用户名" prefix={<UserOutlined />} placeholder="用户名" />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password aria-label="密码" prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading}>
                登录
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Spin>
    </div>
  );
};

export default Login;
