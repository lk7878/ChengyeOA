import { useState } from 'react';
import { Alert, Form, Input, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { authApi } from '@/api/auth';
import { requestErrorMessage } from '@/api/errors';
import { runtimeSession } from '../runtime-session';

export default function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await authApi.changePassword(values.currentPassword, values.password, values.confirmation);
      runtimeSession.setAuthenticated(response.data);
      message.success('密码已修改，其他设备已退出，当前页面可继续使用');
      form.resetFields(); onClose();
    } catch (e) { setError(requestErrorMessage(e, '密码修改失败，请重试')); }
    finally { setBusy(false); }
  };
  return <Modal open={open} title="修改密码" okText="确认修改" cancelText="取消"
    confirmLoading={busy} closable={!busy} keyboard={!busy} mask={{ closable: !busy }}
    cancelButtonProps={{ disabled: busy }} onOk={() => void submit()}
    onCancel={() => { if (!busy) { form.resetFields(); setError(null); onClose(); } }} destroyOnHidden>
    <Alert type="info" showIcon title="密码只属于您的个人账号。修改后其他设备将退出，当前页面和未提交的表单会保留。" style={{ marginBottom: 16 }} />
    {error && <Alert role="alert" type="error" title={error} style={{ marginBottom: 16 }} />}
    <Form form={form} layout="vertical" preserve={false} disabled={busy} onFinish={() => void submit()}>
      <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
        <Input.Password autoComplete="current-password" aria-label="当前密码" />
      </Form.Item>
      <Form.Item name="password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, max: 128, message: '密码需为 6 至 128 个字符' }]}>
        <Input.Password autoComplete="new-password" aria-label="新密码" />
      </Form.Item>
      <Form.Item name="confirmation" label="确认新密码" dependencies={['password']} rules={[
        { required: true, message: '请再次输入新密码' },
        ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')) }),
      ]}>
        <Input.Password autoComplete="new-password" aria-label="确认新密码" onPressEnter={() => void submit()} />
      </Form.Item>
    </Form>
  </Modal>;
}
