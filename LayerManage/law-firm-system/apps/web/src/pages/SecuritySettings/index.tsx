import Table from '@/components/ResizableTable';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, message, Popconfirm, Space, Tag, Typography } from 'antd';
import Modal from '@/components/DraggableModal';
import { authApi } from '@/api/auth';
import { requestErrorMessage } from '@/api/errors';
import ChangePasswordDialog from '@/features/auth/components/ChangePasswordDialog';
import MfaEnrollment from '@/features/auth/components/MfaEnrollment';
import { runtimeSession } from '@/features/auth/runtime-session';
import type { AuthenticatedData, MfaStatusView, SessionView } from '@/features/auth/types';
import { useAuthStore } from '@/stores/authStore';

export default function SecuritySettingsPage() {
  const userId = useAuthStore(state => state.userInfo?.id);
  const authorization = useAuthStore(state => state.authorization);
  const isAdministrator = Boolean(authorization?.isSystemAdmin || authorization?.isSystemSuperAdmin);
  const [status, setStatus] = useState<MfaStatusView | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [enrollment, setEnrollment] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mfa, devices] = await Promise.all([authApi.mfaStatus(), authApi.sessions()]);
      setStatus(mfa.data); setSessions(devices.data);
    } catch (e) { message.error(requestErrorMessage(e, '账号安全加载失败')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const complete = useCallback((data: AuthenticatedData) => {
    runtimeSession.setAuthenticated(data); setEnrollment(null); void load();
  }, [load]);
  const expired = useCallback(() => { setEnrollment(null); message.error('绑定已过期，请重试'); }, []);
  const start = async () => {
    try { setEnrollment((await authApi.startMfaEnrollment()).data.challengeToken); }
    catch (e) { message.error(requestErrorMessage(e, '无法开始绑定')); }
  };
  const revoke = async (id?: string) => {
    try {
      if (id) await authApi.revokeSession(id); else await authApi.logoutAll('', true);
      message.success(id ? '该设备已退出' : '其他设备已退出'); await load();
    } catch (e) { message.error(requestErrorMessage(e, '退出设备失败')); }
  };
  const regenerate = async () => {
    if (!userId) return;
    try {
      const result = await authApi.regenerateRecoveryCodes();
      setCodes(result.data.recoveryCodes); setSaved(false); await load();
    } catch (e) { message.error(requestErrorMessage(e, '恢复码生成失败')); }
  };
  const disable = async () => {
    try {
      await authApi.disableMfa();
      useAuthStore.getState().clearSession();
      message.success('验证器已关闭，请重新登录');
    } catch (e) { message.error(requestErrorMessage(e, '验证器关闭失败')); }
  };
  const columns = [
    { title: '登录设备', key: 'device', render: (_: unknown, row: SessionView, index: number) =>
      row.current ? <Tag color="blue">当前设备</Tag> : <span>其他设备 {index + 1}</span> },
    { title: '登录时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString() },
    { title: '最近活动', dataIndex: 'lastSeenAt', render: (value: string) => new Date(value).toLocaleString() },
    { title: '网络', dataIndex: 'ipPrefix', render: (value: string | null) => value ?? '未记录' },
    { title: '操作', key: 'action', render: (_: unknown, row: SessionView) => row.current ? null :
      <Popconfirm title="确认退出该设备？" onConfirm={() => revoke(row.id)} okText="退出" cancelText="取消">
        <Button danger aria-label={`退出该设备 ${row.id}`}>退出该设备</Button>
      </Popconfirm> },
  ];
  return <section>
    <Typography.Title level={2}>账号安全</Typography.Title>
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card title="登录密码">
        <Typography.Paragraph>密码属于您的个人账号，不与角色共用。仅首次登录或管理员重置后需要修改初始密码，不要求每次登录或定期修改。</Typography.Paragraph>
        <Button onClick={() => setPasswordOpen(true)}>修改密码</Button>
      </Card>
      <Card title="登录设备" loading={loading}>
        <Table rowKey="id" dataSource={sessions} columns={columns} pagination={false} />
        <Popconfirm title="确认退出其他所有设备？当前设备会保留。" onConfirm={() => revoke()} okText="退出" cancelText="取消">
          <Button danger style={{ marginTop: 16 }}>退出其他设备</Button>
        </Popconfirm>
      </Card>
      <Collapse items={[{ key: 'advanced', label: '高级安全设置', children: <>
        <Alert type="info" showIcon title="登录、日常操作和普通审批无需二次验证。只有执行高风险操作的管理员需要绑定身份验证器。" />
        {!isAdministrator && <Typography.Paragraph>普通账号无需安装验证器；以前的绑定也不会影响正常登录。管理员专属操作请联系管理员处理。</Typography.Paragraph>}
        {!isAdministrator && status?.enabled && <Popconfirm title="确认关闭自己的验证器？所有登录设备将退出，旧恢复码会失效。" onConfirm={disable} okText="关闭" cancelText="取消">
          <Button danger>关闭验证器</Button>
        </Popconfirm>}
        {(isAdministrator || status?.enabled) && <>
          <Typography.Paragraph>二次验证：{status?.enabled ? '已绑定' : '未绑定'}。用于永久销毁数据等仍受保护的高风险操作。</Typography.Paragraph>
          {status?.enabled ? <>
            <Typography.Paragraph>剩余恢复码：{status.recoveryCodesRemaining}。请离线保存恢复码；验证器丢失时由授权运维人员按现有管理员恢复流程处理。恢复会撤销旧凭据并记录审计。</Typography.Paragraph>
            <Popconfirm title="重新生成后，旧恢复码将立即失效。确认继续？" onConfirm={regenerate} okText="继续" cancelText="取消">
              <Button>重新生成恢复码</Button>
            </Popconfirm>
          </> : <Button onClick={() => void start()}>绑定身份验证器</Button>}
        </>}
      </> }]} />
    </Space>
    <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    {enrollment && <Modal open title="绑定管理员二次验证" footer={null} onCancel={() => setEnrollment(null)} destroyOnHidden>
      {enrollment && <MfaEnrollment challengeToken={enrollment} onAuthenticated={complete} onExpired={expired} />}
    </Modal>}
    <Modal open={codes.length > 0} title="请立即保存新恢复码" okText="完成" closable={false} mask={{ closable: false }}
      cancelButtonProps={{ style: { display: 'none' } }} okButtonProps={{ disabled: !saved }} onOk={() => setCodes([])}>
      <Alert type="warning" title="这些恢复码只显示一次，请离线安全保存。" />
      <pre>{codes.join('\n')}</pre><Checkbox checked={saved} onChange={e => setSaved(e.target.checked)}>我已安全保存恢复码</Checkbox>
    </Modal>
  </section>;
}
