import { businessLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Descriptions, message, Modal, Space, Tag, Typography } from 'antd';
import { authApi } from '@/api/auth';
import StepUpDialog from '@/features/auth/components/StepUpDialog';
import MfaEnrollment from '@/features/auth/components/MfaEnrollment';
import type { AuthenticatedData, MfaStatusView, SessionView } from '@/features/auth/types';
import { useStepUp } from '@/features/auth/useStepUp';
import { useAuthStore } from '@/stores/authStore';

export default function SecuritySettingsPage() {
  const userId = useAuthStore(state => state.userInfo?.id);
  const authorization = useAuthStore(state => state.authorization);
  const setAuthenticated = useAuthStore(state => state.setAuthenticated);
  const isAdministrator = Boolean(authorization?.isSystemAdmin || authorization?.isSystemSuperAdmin);
  const stepUp = useStepUp();
  const [status, setStatus] = useState<MfaStatusView | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [regenAcknowledged, setRegenAcknowledged] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesSaved, setCodesSaved] = useState(false);
  const [disableConfirm, setDisableConfirm] = useState(false);
  const [preserveCurrent, setPreserveCurrent] = useState(false);
  const [enrollmentChallenge, setEnrollmentChallenge] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mfa, sessionList] = await Promise.all([authApi.mfaStatus(), authApi.sessions()]);
      setStatus(mfa.data);
      setSessions(sessionList.data);
    } catch {
      message.error('安全设置加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const startEnrollment = async () => {
    try {
      const response = await authApi.startMfaEnrollment();
      setEnrollmentChallenge(response.data.challengeToken);
    } catch {
      message.error('无法开始 MFA 绑定，请稍后重试');
    }
  };

  const completeEnrollment = useCallback((data: AuthenticatedData) => {
    setAuthenticated(data);
    setEnrollmentChallenge(null);
    void load();
  }, [load, setAuthenticated]);

  const expireEnrollment = useCallback(() => {
    setEnrollmentChallenge(null);
    message.error('MFA 绑定已过期，请重新开始');
  }, []);

  const regenerate = async () => {
    if (!userId || !regenAcknowledged) return;
    setRegenConfirm(false);
    try {
      const response = await stepUp.run({
        purpose: 'MFA_RECOVERY_CODES_REGENERATE',
        target: { userId },
        impact: '使全部旧恢复码立即失效并生成一组新恢复码',
        mutate: token => authApi.regenerateRecoveryCodes(token),
      });
      setRecoveryCodes(response.data.recoveryCodes);
      setCodesSaved(false);
      setRegenAcknowledged(false);
      await load();
    } catch (error) {
      if ((error as Error).message !== 'STEP_UP_CANCELLED') message.error('恢复码生成失败');
    }
  };

  const disableMfa = async () => {
    if (!userId || isAdministrator) return;
    setDisableConfirm(false);
    try {
      await stepUp.run({
        purpose: 'MFA_DISABLE_SELF', target: { userId }, impact: '停用当前账号的多因素验证',
        mutate: token => authApi.disableMfa(token),
      });
      message.success('MFA 已停用，其他会话已撤销');
      await load();
    } catch (error) {
      if ((error as Error).message !== 'STEP_UP_CANCELLED') message.error('MFA 停用失败');
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await stepUp.run({
        purpose: 'SESSION_REVOKE', target: { sessionId }, impact: `撤销会话 ${sessionId}`,
        mutate: token => authApi.revokeSession(sessionId, token),
      });
      message.success('会话已撤销');
      await load();
    } catch (error) {
      if ((error as Error).message !== 'STEP_UP_CANCELLED') message.error('会话撤销失败');
    }
  };

  const logoutAll = async () => {
    if (!userId) return;
    try {
      await stepUp.run({
        purpose: 'SESSION_REVOKE_ALL', target: { userId }, impact: preserveCurrent ? '撤销当前会话之外的全部会话' : '撤销当前账号的全部会话',
        mutate: token => authApi.logoutAll(token, preserveCurrent),
      });
      message.success('会话撤销请求已完成');
      await load();
    } catch (error) {
      if ((error as Error).message !== 'STEP_UP_CANCELLED') message.error('批量退出失败');
    }
  };

  const columns = [
    {
      title: '会话', key: 'session', render: (_: unknown, session: SessionView) => <Space>
        <Typography.Text code>{session.id}</Typography.Text>
        {session.current && <Tag color="blue">当前会话</Tag>}
      </Space>,
    },
    { title: '验证级别', dataIndex: 'assuranceLevel', render: (value: string) => <Tag>{businessLabel(value)}</Tag> },
    { title: '最近活动', dataIndex: 'lastSeenAt', render: (value: string) => new Date(value).toLocaleString() },
    { title: '网络', dataIndex: 'ipPrefix', render: (value: string | null) => value ?? '未记录' },
    {
      title: '操作', key: 'action', render: (_: unknown, session: SessionView) => session.current ? null : (
        <Button danger aria-label={`撤销会话 ${session.id}`} onClick={() => void revokeSession(session.id)}>撤销</Button>
      ),
    },
  ];

  return (
    <main>
      <Typography.Title level={2}>账号安全</Typography.Title>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Card title="多因素验证" loading={loading}>
          {status && <>
            <Descriptions items={[
              { key: 'state', label: '状态', children: <Tag color={status.enabled ? 'success' : 'default'}>{status.enabled ? '已启用' : '未启用'}</Tag> },
              { key: 'codes', label: '恢复码', children: `剩余恢复码：${status.recoveryCodesRemaining}` },
            ]} />
            {isAdministrator && <Alert type="info" showIcon title="管理员必须保持 MFA 启用" style={{ marginBottom: 16 }} />}
            {status.enabled && <Space wrap>
              <Button aria-label="重新生成恢复码" onClick={() => setRegenConfirm(true)}>重新生成恢复码</Button>
              {!isAdministrator && <Button danger aria-label="停用 MFA" onClick={() => setDisableConfirm(true)}>停用 MFA</Button>}
            </Space>}
            {!status.enabled && !isAdministrator && (
              <Button type="primary" aria-label="启用 MFA" onClick={() => void startEnrollment()}>
                启用 MFA
              </Button>
            )}
          </>}
        </Card>

        <Card title="活动会话" loading={loading}>
          <Table rowKey="id" dataSource={sessions} columns={columns} pagination={false} />
          <Space style={{ marginTop: 16 }} wrap>
            <Checkbox checked={preserveCurrent} onChange={event => setPreserveCurrent(event.target.checked)}>保留当前会话</Checkbox>
            <Button danger aria-label="退出其他会话" onClick={() => void logoutAll()}>退出其他会话</Button>
          </Space>
        </Card>
      </Space>

      {enrollmentChallenge && (
        <Modal
          open
          title="启用多因素验证"
          footer={null}
          onCancel={() => setEnrollmentChallenge(null)}
        >
          <MfaEnrollment
            challengeToken={enrollmentChallenge}
            onAuthenticated={completeEnrollment}
            onExpired={expireEnrollment}
          />
        </Modal>
      )}

      <Modal
        open={regenConfirm}
        title="重新生成恢复码"
        okText="继续生成"
        cancelText="取消"
        okButtonProps={{ disabled: !regenAcknowledged, 'aria-label': '继续生成' }}
        onCancel={() => { setRegenConfirm(false); setRegenAcknowledged(false); }}
        onOk={() => void regenerate()}
      >
        <Alert type="warning" showIcon title="生成后，全部旧恢复码会立即失效。" />
        <Checkbox checked={regenAcknowledged} onChange={event => setRegenAcknowledged(event.target.checked)}>
          我知道旧恢复码将立即失效
        </Checkbox>
      </Modal>

      <Modal
        open={recoveryCodes.length > 0}
        title="请立即保存新恢复码"
        okText="完成"
        okButtonProps={{ disabled: !codesSaved, 'aria-label': '完成' }}
        cancelButtonProps={{ style: { display: 'none' } }}
        closable={false}
        mask={{ closable: false }}
        onOk={() => { setRecoveryCodes([]); setCodesSaved(false); }}
      >
        <Alert type="warning" showIcon title="这些恢复码只显示一次，请离线安全保存。" />
        <pre>{recoveryCodes.join('\n')}</pre>
        <Checkbox checked={codesSaved} onChange={event => setCodesSaved(event.target.checked)}>我已安全保存这些恢复码</Checkbox>
      </Modal>

      <Modal
        open={disableConfirm}
        title="确认停用 MFA？"
        okText="继续停用"
        okButtonProps={{ danger: true }}
        onCancel={() => setDisableConfirm(false)}
        onOk={() => void disableMfa()}
      >
        停用后，其他活动会话将被撤销。
      </Modal>
      <StepUpDialog {...stepUp.dialogProps} />
    </main>
  );
}
