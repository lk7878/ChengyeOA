import { businessLabel } from '@/locales/business-labels';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, DatePicker, Drawer, Form, Input, InputNumber, Select, Space, Spin, Tag, Typography } from 'antd';
import { masterDataApi } from '@/features/master-data/api';
import type { OrganizationNode, Position, ProfessionalTeam } from '@/features/master-data/types';
import { governanceApi } from '../api';
import type { CreateGovernanceOperationInput, GovernanceCatalogEntry, GovernanceUserTarget, GovernedOperationType } from '../types';
import { confirmationPhrase, metadataFieldForTarget, OPERATION_LABELS, type MasterTargetType } from '../form-rules';

const { Text } = Typography;

type FormValues = {
  operationType: GovernedOperationType; targetType?: MasterTargetType; targetId: string;
  expectedTargetVersion: number; reason: string; validUntil?: { toISOString(): string };
  status?: 'ENABLED' | 'DISABLED'; sort?: number; responsibilities?: string; description?: string; confirmation?: string;
};

type Props = {
  open: boolean; catalog: GovernanceCatalogEntry[]; submitting: boolean;
  onClose: () => void; onSubmit: (input: CreateGovernanceOperationInput) => Promise<void>;
};

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `governance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function flattenOrganizations(nodes: OrganizationNode[]): OrganizationNode[] {
  return nodes.flatMap(node => [node, ...flattenOrganizations(node.children ?? [])]);
}

export default function OperationCreateDrawer({ open, catalog, submitting, onClose, onSubmit }: Props) {
  const [form] = Form.useForm<FormValues>();
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [users, setUsers] = useState<GovernanceUserTarget[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationNode[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [teams, setTeams] = useState<ProfessionalTeam[]>([]);
  const idempotencyKey = useRef('');
  const operationType = Form.useWatch('operationType', form);
  const targetType = Form.useWatch('targetType', form);
  const targetId = Form.useWatch('targetId', form);
  const entry = catalog.find(item => item.operationType === operationType);
  const isMasterData = entry?.adapterKey === 'master-data';
  const isGrant = operationType === 'SYSTEM_ADMIN_GRANT' || operationType === 'SUPER_ADMIN_GRANT';
  const metadataField = targetType ? metadataFieldForTarget(targetType) : undefined;

  useEffect(() => {
    if (!open) return;
    idempotencyKey.current = newIdempotencyKey();
    form.resetFields();
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return null;
      setLoadingTargets(true);
      setLoadError(false);
      return Promise.all([
        governanceApi.userTargets(),
        masterDataApi.organizations.options(), masterDataApi.positions.list(),
        masterDataApi.professionalTeams.list({ page: 1, pageSize: 100 }),
      ]);
    }).then(result => {
      if (!active || result === null) return;
      const [userResponse, organizationResponse, positionResponse, teamResponse] = result;
      setUsers(userResponse.data);
      setOrganizations(flattenOrganizations(organizationResponse.data));
      setPositions(positionResponse.data);
      setTeams(teamResponse.data.list);
    }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoadingTargets(false); });
    return () => { active = false; };
  }, [form, open]);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ targetId: undefined as never, expectedTargetVersion: undefined as never });
  }, [form, open, operationType, targetType]);

  const targets = useMemo<Array<{ value: string; label: string; version: number }>>(() => {
    if (!isMasterData) return users.map(user => ({ value: user.id, label: `${user.username}${user.displayName ? ` · ${user.displayName}` : ''}`, version: user.governanceVersion }));
    if (targetType === 'ORGANIZATION') return organizations.map(item => ({ value: item.id, label: `${item.code} · ${item.name}`, version: item.version }));
    if (targetType === 'POSITION') return positions.map(item => ({ value: item.id, label: `${item.code} · ${item.name}`, version: item.version }));
    if (targetType === 'PROFESSIONAL_TEAM') return teams.map(item => ({ value: item.id, label: `${item.code} · ${item.name}`, version: item.version }));
    return [];
  }, [isMasterData, organizations, positions, targetType, teams, users]);

  const confirmationHint = useMemo(() => {
    if (!entry?.confirmationTemplate) return undefined;
    const username = users.find(user => user.id === targetId)?.username ?? '{targetUsername}';
    return confirmationPhrase(entry.confirmationTemplate, username);
  }, [entry, targetId, users]);

  async function submit(values: FormValues) {
    const resolvedTargetType = isMasterData ? values.targetType! : 'USER';
    let payload: Record<string, unknown> = {};
    if (isGrant) payload = { validUntil: values.validUntil?.toISOString() ?? null };
    if (operationType === 'MASTER_DATA_STATUS_CORRECTION') payload = { status: values.status };
    if (operationType === 'MASTER_DATA_METADATA_CORRECTION') {
      const field = metadataFieldForTarget(values.targetType!);
      if (field.key === 'sort') payload = { sort: values.sort };
      if (field.key === 'responsibilities') payload = { responsibilities: values.responsibilities?.trim() || null };
      if (field.key === 'description') payload = { description: values.description?.trim() || null };
    }
    await onSubmit({ operationType: values.operationType, targetType: resolvedTargetType, targetId: values.targetId,
      reason: values.reason.trim(), expectedTargetVersion: values.expectedTargetVersion, payload,
      idempotencyKey: idempotencyKey.current, ...(values.confirmation ? { confirmation: values.confirmation } : {}) });
  }

  return <Drawer title={<span id="governance-create-title">新建治理申请</span>} aria-labelledby="governance-create-title" open={open} onClose={onClose} size={560} className="governance-drawer"
    destroyOnHidden maskClosable={!submitting} extra={<Space><button className="governance-link-button" onClick={onClose} disabled={submitting}>取消</button><button className="governance-primary-button" onClick={() => form.submit()} disabled={submitting}>{submitting ? '提交中…' : '提交申请'}</button></Space>}>
    {loadError && <Alert type="warning" showIcon title="部分目标数据加载失败" description="可关闭抽屉后重试。" />}
    <Spin spinning={loadingTargets}>
      <Form form={form} layout="vertical" onFinish={submit} requiredMark="optional">
        <Form.Item name="operationType" label="治理操作" rules={[{ required: true, message: '请选择治理操作' }]}>
          <Select aria-label="治理操作" placeholder="请选择" options={catalog.map(item => ({ value: item.operationType, label: OPERATION_LABELS[item.operationType] }))} />
        </Form.Item>
        {entry && <div className="governance-operation-meta"><Tag>{businessLabel(entry.riskLevel)}</Tag><Tag>{entry.reviewMode === 'PRE' ? '事前审核' : '事后审核'}</Tag></div>}
        {isMasterData && <Form.Item name="targetType" label="主数据类型" rules={[{ required: true, message: '请选择主数据类型' }]}>
          <Select aria-label="主数据类型" options={[{ value: 'ORGANIZATION', label: '组织' }, { value: 'POSITION', label: '岗位' }, { value: 'PROFESSIONAL_TEAM', label: '专业团队' }]} />
        </Form.Item>}
        {entry && <Form.Item name="targetId" label="操作目标" rules={[{ required: true, message: '请选择操作目标' }]}>
          <Select aria-label="操作目标" showSearch optionFilterProp="label" placeholder="搜索并选择目标" disabled={isMasterData && !targetType} options={targets}
            onChange={value => { const target = targets.find(item => item.value === value); if (target?.version !== undefined) form.setFieldValue('expectedTargetVersion', target.version); }} />
        </Form.Item>}
        <Form.Item name="expectedTargetVersion" hidden rules={[{ required: true }]}><InputNumber /></Form.Item>
        {isGrant && <Form.Item name="validUntil" label="授权截止时间" extra="留空表示长期授权，临时授权最长 90 天。"><DatePicker showTime className="governance-full-width" /></Form.Item>}
        {operationType === 'MASTER_DATA_STATUS_CORRECTION' && <Form.Item name="status" label="纠正后状态" rules={[{ required: true, message: '请选择状态' }]}><Select options={[{ value: 'ENABLED', label: '启用' }, { value: 'DISABLED', label: '停用' }]} /></Form.Item>}
        {operationType === 'MASTER_DATA_METADATA_CORRECTION' && metadataField?.key === 'sort' && <Form.Item name="sort" label={metadataField.label} rules={[{ required: true, message: '请输入排序值' }]}><InputNumber min={0} precision={0} className="governance-full-width" /></Form.Item>}
        {operationType === 'MASTER_DATA_METADATA_CORRECTION' && metadataField?.key === 'responsibilities' && <Form.Item name="responsibilities" label={metadataField.label}><Input.TextArea rows={4} maxLength={2000} showCount /></Form.Item>}
        {operationType === 'MASTER_DATA_METADATA_CORRECTION' && metadataField?.key === 'description' && <Form.Item name="description" label={metadataField.label}><Input.TextArea rows={4} maxLength={2000} showCount /></Form.Item>}
        <Form.Item name="reason" label="申请理由" rules={[{ required: true, whitespace: true, min: 10, message: '请填写至少 10 个字符的申请理由' }]}><Input.TextArea rows={4} maxLength={1000} showCount /></Form.Item>
        {confirmationHint && <Form.Item name="confirmation" label="关键操作确认" extra={<Text copyable code>{confirmationHint}</Text>} rules={[{ required: true, message: '请输入完整确认短语' }, { validator: (_, value) => value === confirmationHint ? Promise.resolve() : Promise.reject(new Error('确认短语不匹配')) }]}><Input autoComplete="off" /></Form.Item>}
      </Form>
    </Spin>
  </Drawer>;
}
