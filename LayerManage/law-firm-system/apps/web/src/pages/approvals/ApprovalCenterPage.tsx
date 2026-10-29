import { Link } from 'react-router';
import Table from '@/components/ResizableTable';
// SPEC-013 Task 8: 审批中心页（APPROVAL 中心三 Tab + 新建申请 + 处理动作 + 详情）。
// 形态沿 RefundListPage（AntD 6 + store 模式）：三 Tab 共享一个列表状态 + activeRole
// （APPLIED 我的申请 / TODO 我的待办 / DONE 我的已办），切 Tab 即按 role 回源。
// 新建申请 Modal：definitions（approval.apply 门控）按 formSchema.fields 动态渲染五类表单
// （LEAVE 起止日期/事由、SEAL 用印类型/份数、EXPENSE 金额/类别、CONTRACT_CHANGE 合同/变更摘要、
// TRANSFER 目标团队/事由），content 提交 + title 默认类型名。
// 待办行审批/驳回按钮挂 approval.process（action APPROVE/REJECT + remark 可选，幂等 key 每开一次
// 生成）；我的申请 PENDING 行可撤回（approval.apply）。整页路由级 AuthorizedPage 挂 approval.read
// （查看已办只需读），新建按钮按 approval.apply 门控。
// SPEC-020 Task 2：待办行/详情弹窗 PENDING 任务「加签」按钮（approval.process 门控）→ 加签 Modal
// （目标 userIds 逗号分隔 Input）→ addSigners(taskId, {addSignerUserIds}) → 成功 message + 刷新 TODO。
// SPEC-023 Task 2：全组织视图——「全部审批」Tab（key='ALL'，approval.manage 门控，无码用户不见）——
// 管理员纵览全组织审批实例（listInstances role='ALL'，无 actor 过滤）；列表/详情/操作复用（操作仍 actor
// 语义——ALL 列表行 pendingTask 恒 null，管理员对非自身 task 无操作按钮）；详情弹窗以列表行数据渲染
// （M3 兜底：列表行已含 content/tasks 全数据，不额外 getInstance，manage-only 无 read 用户不受详情 403 影响）。
// SPEC-025 Task 3：定义管理 Tab 增「导出」「导入」按钮（approval.manage 门控）——导出 GET /definitions/export
// → Blob + a.download 下载 JSON 快照（approval-definitions-{date}.json）；导入上传 JSON（.json）→ 解析 →
// I×1 round-trip 修复（每项剥离视图字段 id/createdAt/updatedAt，仅保留 import 白名单 8 键）→ POST
// /definitions/import → 成功 message（imported/updated）+ 刷新列表；失败 message.error（业务码）。
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Tabs,
  Tag,
  message,
  type TabsProps,
} from 'antd';
import Modal from '@/components/DraggableModal';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import ApprovalAttachments from './materials/ApprovalAttachments';
import { approvalMaterialsApi, type ApprovalAttachment } from '@/api/approval-materials';
import { exportApprovalMaterial } from './materials/approval-print';
import { useApprovalStore } from '@/stores/approval-store';
import { useAuthStore } from '@/stores/authStore';
import {
  APPROVAL_BUSINESS_TYPES,
  INSTANCE_STATUSES,
  approvalApi,
  type ApprovalBusinessType,
  type ApprovalStatsView,
  type ApprovalDefinitionView,
  type ApprovalFormField,
  type ApprovalFormSchema,
  type ApprovalInstanceStatus,
  type ApprovalInstanceView,
  type ApprovalRoleFilter,
  type ApprovalTaskStatus,
  type ApprovalTaskView,
  type ImportDefinitionsInput,
} from '@/api/approval';

const TABS: Array<{ key: ApprovalRoleFilter; label: string }> = [
  { key: 'APPLIED', label: '我的申请' },
  { key: 'TODO', label: '我的待办' },
  { key: 'DONE', label: '我的已办' },
];

const BUSINESS_TYPE_META: Record<string, { text: string; color: string }> = {
  PAYROLL: { text: '工资发放', color: 'gold' },
  QUALITY_ANALYSIS:{text:'专项分析关闭',color:'blue'},
  SOP_REVIEW: { text: 'SOP成果审核', color: 'blue' },
  CUSTOM: { text: '自定义审批', color: 'geekblue' },
  EXPENSE: { text: '费用报销', color: 'cyan' },
  CONTRACT_CHANGE: { text: '合同变更', color: 'blue' },
  SEAL: { text: '用印申请', color: 'purple' },
  LEAVE: { text: '请假申请', color: 'green' },
  TRANSFER: { text: '转所申请', color: 'orange' },
};

const INSTANCE_STATUS_META: Record<ApprovalInstanceStatus, { text: string; color: string }> = {
  PENDING: { text: '审批中', color: 'gold' },
  APPROVED: { text: '已通过', color: 'blue' },
  REJECTED: { text: '已驳回', color: 'red' },
  WITHDRAWN: { text: '已撤回', color: 'default' },
};

const TASK_STATUS_META: Record<ApprovalTaskStatus, { text: string; color: string }> = {
  PENDING: { text: '待处理', color: 'gold' },
  APPROVED: { text: '已通过', color: 'blue' },
  REJECTED: { text: '已驳回', color: 'red' },
  CANCELLED: { text: '已取消', color: 'default' },
};

// SPEC-017 Task 3：定义管理状态 Tag（ACTIVE 蓝 / DISABLED 灰）。
const DEFINITION_STATUS_META: Record<string, { text: string; color: string }> = {
  ACTIVE: { text: '启用', color: 'blue' },
  DISABLED: { text: '禁用', color: 'default' },
};

/** 逗号分隔审批人取值（userIds / roleCodes）解析：去空白、滤空。 */
function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** SPEC-025 导入字段白名单（镜像后端 ImportDefinitionsInput）：仅保留配置快照 8 键。 */
const IMPORT_DEFINITION_KEYS = [
  'code',
  'name',
  'businessType',
  'formSchema',
  'approverRule',
  'nodeSchema',
  'version',
  'status',
] as const;

/** SPEC-025 I×1 round-trip 修复：导入上传前剥离视图字段（id/createdAt/updatedAt）——「导出下载 → 原样上传」
 *  round-trip 可用（否则后端 assertExactKeys 对多余键 400）。缺键项不注入（保持导出快照语义）。 */
function stripDefinitionViewFields(
  raw: Record<string, unknown>,
): ImportDefinitionsInput['definitions'][number] {
  const out: Record<string, unknown> = {};
  for (const key of IMPORT_DEFINITION_KEYS) {
    if (key in raw) out[key] = raw[key];
  }
  return out as unknown as ImportDefinitionsInput['definitions'][number];
}

/** 动作失败读 response.data.message（业务码）；无则兜底「操作失败」（沿 approval-store actionErrorMessage）。 */
function apiErrorMessage(error: unknown): string {
  return (
    (error as { response?: { data?: { message?: string } } } | undefined)?.response?.data?.message ??
    '操作失败'
  );
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface TaskNodeGroup {
  nodeName: string;
  tasks: ApprovalTaskView[];
}

/** 将实例 tasks 按 nodeName 分组（保持链顺序——后端按 createdAt asc 返回，节点[0] 先于节点[1]）。 */
function groupTasksByNode(tasks: ApprovalTaskView[]): TaskNodeGroup[] {
  const groups: TaskNodeGroup[] = [];
  const indexByNode = new Map<string, number>();
  for (const task of tasks) {
    const groupIndex = indexByNode.get(task.nodeName);
    if (groupIndex === undefined) {
      indexByNode.set(task.nodeName, groups.length);
      groups.push({ nodeName: task.nodeName, tasks: [task] });
    } else {
      groups[groupIndex].tasks.push(task);
    }
  }
  return groups;
}

/** 当前节点名：currentNode 下标对应分组（越界兜底最后分组）。 */
function currentNodeName(record: ApprovalInstanceView): string | null {
  const groups = groupTasksByNode(record.tasks);
  const group = groups[record.currentNode] ?? groups[groups.length - 1] ?? null;
  return group?.nodeName ?? null;
}

/** 节点进度元信息：PENDING 实例 currentNode 之前=已完成、当前=审批中；终态实例末分组显示实例终态。 */
function nodeStateMeta(
  record: ApprovalInstanceView,
  groups: TaskNodeGroup[],
  index: number,
): { text: string; color: string } {
  if (record.status === 'PENDING') {
    // SPEC-016 minor 加固（Task 4 ⚠️②）：越界 currentNode（≥ groups.length）clamp 到末分组，
    // 防纯防御路径下全部节点渲染"已完成"、无"审批中"（真实数据恒在界内，纯防御）。
    const clamped = Math.min(record.currentNode, groups.length - 1);
    if (index < clamped) return { text: '已完成', color: 'blue' };
    return { text: '审批中', color: 'gold' };
  }
  if (index < groups.length - 1) return { text: '已完成', color: 'blue' };
  const finalMeta = INSTANCE_STATUS_META[record.status];
  return finalMeta
    ? { text: finalMeta.text, color: finalMeta.color }
    : { text: record.status, color: 'default' };
}

/** SPEC-018 会签：nodeSchema 链按下标取节点 mode（缺省 ANY）。非数组/null → undefined（单节点无会签标注）。 */
function nodeSchemaModeAt(record: ApprovalInstanceView, index: number): 'ANY' | 'ALL' | undefined {
  if (!Array.isArray(record.nodeSchema)) return undefined;
  const node = record.nodeSchema[index] as Record<string, unknown> | undefined;
  const mode = node?.mode;
  return mode === 'ALL' ? 'ALL' : mode === 'ANY' ? 'ANY' : undefined;
}

function getSchemaFields(formSchema: ApprovalDefinitionView['formSchema'] | undefined): ApprovalFormField[] {
  if (!formSchema || typeof formSchema !== 'object' || Array.isArray(formSchema)) return [];
  const fields = (formSchema as { fields?: unknown }).fields;
  return Array.isArray(fields) ? (fields as ApprovalFormField[]) : [];
}

function businessTypeText(value: string): string {
  return BUSINESS_TYPE_META[value]?.text ?? value;
}

type ActionModal = 'approve' | 'reject' | null;

const ApprovalCenterPage: React.FC<{ initialInstanceId?: string; initialRole?: ApprovalRoleFilter }> = ({
  initialInstanceId,
  initialRole,
}) => {
  const {
    instances,
    listTotal,
    listPage,
    listPageSize,
    listLoading,
    listError,
    activeRole,
    definitions,
    definitionsLoading,
    fetchInstances,
    fetchDefinitions,
    applyApproval,
    processApproval,
    withdrawApproval,
  } = useApprovalStore();
  const canApply = useAuthStore((state) => state.hasPermission('approval.apply'));
  const canProcess = useAuthStore((state) => state.hasPermission('approval.process'));
  const canManage = useAuthStore((state) => state.hasPermission('approval.manage'));
  const currentUserId = useAuthStore((state) => state.userInfo?.id);

  const [createOpen, setCreateOpen] = useState(false);
  const [attachments, setAttachments] = useState<ApprovalAttachment[]>([]);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [customTypeOpen, setCustomTypeOpen] = useState(false);
  const [customTypeSaving, setCustomTypeSaving] = useState(false);
  const [customTypeForm] = Form.useForm();
  const [detailOpen, setDetailOpen] = useState(false);
  const [linkedError, setLinkedError] = useState('');
  const [linkedRetry, setLinkedRetry] = useState(0);
  const [activeRecord, setActiveRecord] = useState<ApprovalInstanceView | null>(null);
  const [activeTask, setActiveTask] = useState<ApprovalTaskView | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [submitting, setSubmitting] = useState(false);
  // SPEC-019 Task 2：转交 Modal（approval.process）——目标 userId 必填，提交 forwardTask。
  const [forwardOpen, setForwardOpen] = useState(false);
  // SPEC-020 Task 2：加签 Modal（approval.process）——目标 userIds 逗号分隔，提交 addSigners。
  const [addSignerOpen, setAddSignerOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [actionForm] = Form.useForm();
  const [forwardForm] = Form.useForm();
  const [addSignerForm] = Form.useForm();
  const createKeyRef = useRef('');
  const processKeyRef = useRef('');
  // SPEC-025 Task 3：隐藏文件 input（导入 JSON 定义快照）。
  const importFileRef = useRef<HTMLInputElement>(null);
  const watchedCode = Form.useWatch('definitionCode', createForm);
  const selectedDefinition = definitions.find((def) => def.code === watchedCode);

  // SPEC-017 Task 3：定义管理 Tab（approval.manage 门控）。activeTab 覆盖三 role + MANAGE
  // （store activeRole 仅用于列表三 Tab；MANAGE 非 role，本地 state 承接）。
  const [activeTab, setActiveTab] = useState<ApprovalRoleFilter | 'MANAGE'>(activeRole);
  const [definitionsManage, setDefinitionsManage] = useState<ApprovalDefinitionView[]>([]);
  const [definitionsManageLoading, setDefinitionsManageLoading] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [manageSubmitting, setManageSubmitting] = useState(false);
  const [editingDefinition, setEditingDefinition] = useState<ApprovalDefinitionView | null>(null);
  const [manageForm] = Form.useForm();

  // SPEC-028 Task 2：全组织视图（ALL Tab）筛选/搜索状态——仅 role='ALL' 生效。
  const [allFilters, setAllFilters] = useState<{
    businessType?: ApprovalBusinessType;
    status?: ApprovalInstanceStatus;
    applicantId?: string;
    keyword?: string;
  }>({});
  const [exportingCsv, setExportingCsv] = useState(false);
  // SPEC-030 Task 2：全组织审批统计（ALL Tab）——与列表同筛选。
  const [statsData, setStatsData] = useState<ApprovalStatsView | null>(null);

  useEffect(() => {
    const role = initialRole === 'ALL' && !canManage ? 'APPLIED' : (initialRole ?? activeRole);
    void Promise.resolve().then(() => {
      if (initialRole) setActiveTab(role);
      void fetchInstances(role, 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabChange = (key: string) => {
    if (key === 'MANAGE') {
      setActiveTab('MANAGE');
      void fetchDefinitionsManage();
      return;
    }
    // 'ALL'（全部审批，SPEC-023）为合法 ApprovalRoleFilter——落入通用 role 分支：
    // setActiveTab('ALL') + fetchInstances('ALL', 1)（role=ALL 后端 approval.manage 门控）。
    setActiveTab(key as ApprovalRoleFilter);
    void fetchInstances(key as ApprovalRoleFilter, 1);
    // SPEC-030：切到 ALL Tab 拉取统计（当前筛选）。
    if (key === 'ALL') void fetchStats(allFilters);
  };

  // ==== SPEC-017 Task 3：定义管理 ====

  /** GET /definitions/manage（approval.manage）：全量含 DISABLED，code 升序。 */
  const fetchDefinitionsManage = async () => {
    setDefinitionsManageLoading(true);
    try {
      const res = await approvalApi.listDefinitionsManage();
      setDefinitionsManage(res.data);
    } catch {
      // 错误经 request 拦截器 message.error 呈现；列表保持现状。
    } finally {
      setDefinitionsManageLoading(false);
    }
  };

  const openManageCreate = () => {
    manageForm.resetFields();
    manageForm.setFieldsValue({ approverRuleType: 'ROLE', businessType: 'LEAVE' });
    setEditingDefinition(null);
    setManageModalOpen(true);
  };

  const openManageEdit = (record: ApprovalDefinitionView) => {
    const rule = (record.approverRule ?? {}) as { type?: string; userIds?: string[]; roleCodes?: string[] };
    manageForm.resetFields();
    manageForm.setFieldsValue({
      code: record.code,
      name: record.name,
      businessType: record.businessType,
      version: record.version,
      formSchemaJson: JSON.stringify(record.formSchema, null, 2),
      approverRuleType: rule.type ?? 'ROLE',
      // SUPERVISOR（直属上级）无取值 CSV（levels 可 JSON 编辑器透传，此处保持默认直属上级）。
      approverRuleValue:
        rule.type === 'SUPERVISOR'
          ? ''
          : (rule.type === 'USER' ? (rule.userIds ?? []) : (rule.roleCodes ?? [])).join(', '),
      nodeSchemaJson: record.nodeSchema ? JSON.stringify(record.nodeSchema, null, 2) : '',
    });
    setEditingDefinition(record);
    setManageModalOpen(true);
  };

  const handleManageSubmit = async (values: Record<string, unknown>) => {
    const code = (values.code as string)?.trim() ?? '';
    const name = (values.name as string)?.trim() ?? '';
    const businessType = values.businessType as ApprovalBusinessType;
    const approverRuleType = (values.approverRuleType as 'USER' | 'ROLE' | 'SUPERVISOR') ?? 'ROLE';
    // SUPERVISOR（直属上级）无需取值 CSV——按申请人报告线自动解析；USER/ROLE 需取值。
    const approverRuleValues = parseCsv((values.approverRuleValue as string) ?? '');
    if (approverRuleType !== 'SUPERVISOR' && approverRuleValues.length === 0) {
      message.error('请填写审批人取值（逗号分隔）');
      return;
    }
    let formSchema: ApprovalFormSchema;
    try {
      formSchema = JSON.parse((values.formSchemaJson as string) ?? '') as ApprovalFormSchema;
    } catch {
      message.error('表单 Schema 需为合法 JSON');
      return;
    }
    if (!formSchema || typeof formSchema !== 'object' || !Array.isArray(formSchema.fields)) {
      message.error('表单 Schema 需含 fields 数组');
      return;
    }
    let nodeSchema: Record<string, unknown> | null = null;
    const nodeSchemaJson = (values.nodeSchemaJson as string) ?? '';
    if (nodeSchemaJson.trim()) {
      try {
        nodeSchema = JSON.parse(nodeSchemaJson) as Record<string, unknown>;
      } catch {
        message.error('节点 Schema 需为合法 JSON');
        return;
      }
    }
    const approverRule =
      approverRuleType === 'USER'
        ? { type: 'USER', userIds: approverRuleValues }
        : approverRuleType === 'ROLE'
          ? { type: 'ROLE', roleCodes: approverRuleValues }
          : { type: 'SUPERVISOR' };

    setManageSubmitting(true);
    try {
      if (editingDefinition) {
        await approvalApi.updateDefinition(editingDefinition.code, {
          name,
          formSchema,
          approverRule,
          nodeSchema,
        });
        message.success('定义已更新');
      } else {
        await approvalApi.createDefinition({
          code,
          name,
          businessType,
          formSchema,
          approverRule,
          nodeSchema,
        });
        message.success('定义已创建');
      }
      setManageModalOpen(false);
      void fetchDefinitionsManage();
    } catch (error) {
      message.error(apiErrorMessage(error));
    } finally {
      setManageSubmitting(false);
    }
  };

  /** 禁用/启用：Popconfirm → PATCH status（ACTIVE↔DISABLED），version+1（后端）。 */
  const handleToggleDefinitionStatus = async (record: ApprovalDefinitionView) => {
    const nextStatus = record.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED';
    setManageSubmitting(true);
    try {
      await approvalApi.updateDefinition(record.code, { status: nextStatus });
      message.success(nextStatus === 'DISABLED' ? '定义已禁用' : '定义已启用');
      void fetchDefinitionsManage();
    } catch (error) {
      message.error(apiErrorMessage(error));
    } finally {
      setManageSubmitting(false);
    }
  };

  // ==== SPEC-025 Task 3：定义导入导出（approval.manage）====

  /** 导出：GET /definitions/export → {schemaVersion, definitions} 包络 → Blob + a.download（文件名 approval-definitions-{date}.json）。 */
  const handleExportDefinitions = async () => {
    try {
      const res = await approvalApi.exportDefinitions();
      const payload = res.data;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `approval-definitions-${dayjs().format('YYYY-MM-DD')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      message.success(`已导出 ${payload.definitions.length} 条定义`);
    } catch (error) {
      message.error(apiErrorMessage(error));
    }
  };

  // ==== SPEC-028 Task 2：全组织视图筛选 + CSV 导出（approval.manage）====

  /** 导出：GET /approvals/export → CSV 文本（UTF-8 BOM）→ Blob + a.download（文件名 approval-instances-{date}.csv）。 */
  const handleExportAllCsv = async () => {
    setExportingCsv(true);
    try {
      const res = await approvalApi.exportApprovalsCsv(allFilters);
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `approval-instances-${dayjs().format('YYYY-MM-DD')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      message.success('全组织审批已导出 CSV');
    } catch (error) {
      message.error(apiErrorMessage(error));
    } finally {
      setExportingCsv(false);
    }
  };

  // ==== SPEC-030 Task 2：全组织审批统计（ALL Tab，approval.manage）====

  /** 拉取统计：GET /approvals/stats（当前筛选）→ 统计卡片刷新；失败静默（列表仍可用）。 */
  const fetchStats = async (filters: typeof allFilters) => {
    try {
      const res = await approvalApi.approvalStats(filters);
      setStatsData(res.data);
    } catch {
      // 错误经 request 拦截器 message.error；统计区保持上次值。
    }
  };

  /** 打开隐藏文件选择器（accept=".json"）。 */
  const openImportPicker = () => {
    importFileRef.current?.click();
  };

  const handleImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 重置 value：允许再次选择同一文件（否则连续导入同文件不触发 change）。
    event.target.value = '';
    if (file) void handleImportDefinitions(file);
  };

  /** 导入：解析 JSON → I×1 round-trip 修复（逐项剥离视图字段，保留 schemaVersion）→ POST /definitions/import → 成功 message + 刷新列表。 */
  const handleImportDefinitions = async (file: File) => {
    let rawDefinitions: unknown;
    let schemaVersion: number | undefined;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      // 兼容三种形态：导出下载的裸数组；{definitions:[...]} 包络；SPEC-029 {schemaVersion, definitions} 包络。
      if (Array.isArray(parsed)) {
        rawDefinitions = parsed;
      } else {
        const envelope = parsed as { schemaVersion?: unknown; definitions?: unknown } | null;
        const definitions = envelope?.definitions;
        if (!Array.isArray(definitions)) throw new Error('missing definitions array');
        rawDefinitions = definitions;
        if (typeof envelope?.schemaVersion === 'number') schemaVersion = envelope.schemaVersion;
      }
    } catch {
      message.error('导入文件需为含 definitions 数组的合法 JSON');
      return;
    }
    const definitions = (rawDefinitions as Record<string, unknown>[]).map(stripDefinitionViewFields);
    setManageSubmitting(true);
    try {
      // schemaVersion 可选：缺省（裸数组文件）不携带——保持旧文件形态向后兼容。
      const res = await approvalApi.importDefinitions(
        schemaVersion === undefined ? { definitions } : { schemaVersion, definitions },
      );
      const { imported = 0, updated = 0 } = res.data ?? {};
      message.success(
        imported > 0
          ? `导入成功：新增 ${imported} 条${updated > 0 ? `，更新 ${updated} 条` : ''}`
          : `导入成功：更新 ${updated} 条`,
      );
      void fetchDefinitionsManage();
    } catch (error) {
      message.error(apiErrorMessage(error));
    } finally {
      setManageSubmitting(false);
    }
  };

  const openCreate = () => {
    createForm.resetFields();
    setAttachments([]);
    setMaterialsBusy(false);
    createKeyRef.current = newIdempotencyKey();
    setCreateOpen(true);
    if (definitions.length === 0) void fetchDefinitions();
  };

  const handleDefinitionChange = (code: string) => {
    const definition = definitions.find((item) => item.code === code);
    if (definition) createForm.setFieldValue('title', definition.name);
  };

  const handleCreate = async (values: Record<string, unknown>) => {
    if (!selectedDefinition || materialsBusy) return;
    const content: Record<string, unknown> = {};
    for (const field of getSchemaFields(selectedDefinition.formSchema)) {
      const raw = values[field.key];
      content[field.key] =
        field.type === 'date'
          ? ((raw as { toISOString?: () => string } | undefined)?.toISOString?.() ?? (raw as string))
          : field.type === 'number'
            ? Number(raw)
            : ((raw as string | undefined) ?? '');
    }
    setSubmitting(true);
    try {
      const created = await applyApproval({
        definitionCode: selectedDefinition.code,
        title: (values.title as string)?.trim() || selectedDefinition.name,
        content,
        ...(attachments.length ? { attachmentIds: attachments.map((file) => file.id) } : {}),
        idempotencyKey: createKeyRef.current,
      });
      if (!created) return;
      message.success('审批申请已提交');
      setCreateOpen(false);
      void fetchInstances(activeRole, 1);
    } finally {
      setSubmitting(false);
    }
  };

  const createPersonalType = async (values: { name: string; templateCode: string }) => {
    setCustomTypeSaving(true);
    try {
      const response = await approvalMaterialsApi.createType(values);
      await fetchDefinitions();
      createForm.setFieldsValue({ definitionCode: response.data.code, title: response.data.name });
      setCustomTypeOpen(false);
      message.success('个人审批类型已创建，可重复使用');
    } catch {
      /* 请求层保留并提示错误 */
    } finally {
      setCustomTypeSaving(false);
    }
  };

  const reapply = async (record: ApprovalInstanceView) => {
    openCreate();
    setDetailOpen(false);
    setSubmitting(true);
    try {
      const available = (await approvalApi.definitions()).data;
      const definition = available.find((item) => item.id === record.definitionId);
      const values: Record<string, unknown> = { ...record.content, title: record.title };
      if (definition) {
        values.definitionCode = definition.code;
        for (const field of getSchemaFields(definition.formSchema))
          if (field.type === 'date' && values[field.key])
            values[field.key] = dayjs(String(values[field.key]));
      }
      createForm.setFieldsValue(values);
      const sourceFiles = (await approvalMaterialsApi.list(record.id)).data;
      for (const source of sourceFiles) {
        const copied = (await approvalMaterialsApi.clone(source.id)).data;
        setAttachments((current) => [...current, copied]);
      }
    } catch {
      message.error('部分材料未能复制，请核对附件清单后再提交');
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (field: ApprovalFormField): React.ReactNode => {
    switch (field.type) {
      case 'date':
        return <DatePicker aria-label={field.label} style={{ width: '100%' }} />;
      case 'textarea':
        return <Input.TextArea aria-label={field.label} rows={2} maxLength={500} />;
      case 'number':
        return <InputNumber aria-label={field.label} min={0} style={{ width: '100%' }} />;
      default:
        return <Input aria-label={field.label} maxLength={200} />;
    }
  };

  useEffect(() => {
    if (!initialInstanceId) return;
    let active = true;
    void approvalApi
      .detail(initialInstanceId)
      .then((result) => {
        if (active) {
          setActiveRecord(result.data);
          setDetailOpen(true);
          setLinkedError('');
        }
      })
      .catch(() => {
        if (active) {
          setActiveRecord(null);
          setDetailOpen(false);
          setLinkedError('关联审批不存在、无权查看或加载失败，请刷新重试。');
        }
      });
    return () => {
      active = false;
    };
  }, [initialInstanceId, linkedRetry]);

  const visibleRecordId =
    detailOpen || actionModal || forwardOpen || addSignerOpen ? activeRecord?.id : undefined;
  useEffect(() => {
    if (!visibleRecordId) return;
    let active = true;
    let pending = false;
    const validate = async () => {
      if (pending) return;
      pending = true;
      try {
        await approvalApi.detail(visibleRecordId);
      } catch {
        if (active) {
          setActiveRecord(null);
          setActiveTask(null);
          setDetailOpen(false);
          setActionModal(null);
          setForwardOpen(false);
          setAddSignerOpen(false);
          actionForm.resetFields();
          forwardForm.resetFields();
          addSignerForm.resetFields();
          setLinkedError('审批详情已不可用，请重新加载后办理。');
        }
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => void validate(), 5000);
    window.addEventListener('focus', validate);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', validate);
    };
  }, [visibleRecordId, actionForm, forwardForm, addSignerForm]);

  const openDetail = (record: ApprovalInstanceView) => {
    setActiveRecord(record);
    setDetailOpen(true);
  };

  const openAction = (
    modal: Exclude<ActionModal, null>,
    record: ApprovalInstanceView,
    task: ApprovalTaskView,
  ) => {
    actionForm.resetFields();
    processKeyRef.current = newIdempotencyKey();
    setActiveRecord(record);
    setActiveTask(task);
    setActionModal(modal);
  };

  // SPEC-019 Task 2：打开转交 Modal（仅当前用户的 PENDING 任务；:id=taskId）。
  const openForward = (task: ApprovalTaskView) => {
    forwardForm.resetFields();
    setActiveTask(task);
    setForwardOpen(true);
  };

  // SPEC-020 Task 2：打开加签 Modal（仅当前用户的 PENDING 任务；:id=taskId，目标可多 userId 逗号分隔）。
  const openAddSigners = (task: ApprovalTaskView) => {
    addSignerForm.resetFields();
    setActiveTask(task);
    setAddSignerOpen(true);
  };

  const handleActionOk = async () => {
    if (!activeTask) return;
    const values = await actionForm.validateFields();
    setSubmitting(true);
    try {
      const ok = await processApproval(activeTask.id, {
        action: actionModal === 'approve' ? 'APPROVE' : 'REJECT',
        remark: values.comment?.trim() || undefined,
        idempotencyKey: processKeyRef.current,
      });
      if (!ok) return;
      message.success(actionModal === 'approve' ? '审批已通过' : '审批已驳回');
      setActionModal(null);
      setActiveRecord(null);
      setActiveTask(null);
      void fetchInstances('TODO', 1);
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (record: ApprovalInstanceView) => {
    const ok = await withdrawApproval(record.id, { reason: '主动撤回' });
    if (ok) {
      message.success('审批已撤回');
      void fetchInstances('APPLIED', 1);
    }
  };

  // SPEC-019 Task 2：转交提交——forwardTask(taskId, {forwardToUserId}) → 成功 message + 刷新 TODO。
  // submitting 态防连点（confirmLoading 复用）。
  const handleForwardOk = async () => {
    if (!activeTask) return;
    const values = await forwardForm.validateFields();
    const forwardToUserId = (values.forwardToUserId as string)?.trim() ?? '';
    if (!forwardToUserId) {
      message.error('请填写目标审批人 ID');
      return;
    }
    setSubmitting(true);
    try {
      await approvalApi.forwardTask(activeTask.id, { forwardToUserId });
      message.success('任务已转交');
      setForwardOpen(false);
      setActiveTask(null);
      void fetchInstances('TODO', 1);
    } catch (error) {
      message.error(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  // SPEC-020 Task 2：加签提交——addSigners(taskId, {addSignerUserIds}) → 成功 message + 刷新 TODO。
  // 逗号分隔多目标经 parseCsv 拆分去空白为数组；submitting 态防连点（confirmLoading 复用）。
  const handleAddSignersOk = async () => {
    if (!activeTask) return;
    const values = await addSignerForm.validateFields();
    const addSignerUserIds = parseCsv((values.addSignerUserIds as string) ?? '');
    if (addSignerUserIds.length === 0) {
      message.error('请填写加签目标审批人 ID');
      return;
    }
    setSubmitting(true);
    try {
      await approvalApi.addSigners(activeTask.id, { addSignerUserIds });
      message.success('加签成功');
      setAddSignerOpen(false);
      setActiveTask(null);
      void fetchInstances('TODO', 1);
    } catch (error) {
      message.error(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const myPendingTask = (record: ApprovalInstanceView): ApprovalTaskView | null =>
    record.tasks.find(
      (task) => task.status === 'PENDING' && (!currentUserId || task.assigneeId === currentUserId),
    ) ??
    record.tasks.find((task) => task.status === 'PENDING') ??
    null;

  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title', width: 220 },
    {
      title: '类型',
      dataIndex: 'businessType',
      key: 'businessType',
      width: 100,
      render: (value: string, record: ApprovalInstanceView) => {
        const meta = BUSINESS_TYPE_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{record.formSnapshot?.name || meta.text}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: ApprovalInstanceStatus) => {
        const meta = INSTANCE_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '节点',
      key: 'currentNode',
      width: 110,
      render: (_: unknown, record: ApprovalInstanceView) => {
        const name = currentNodeName(record);
        if (!name) return '-';
        // 单节点通用名 '审批' 弱化展示；多级节点名（如 主管初审/合伙人终审）以 Tag 突出。
        return name === '审批' ? (
          <span style={{ color: 'rgba(0, 0, 0, 0.45)' }}>{name}</span>
        ) : (
          <Tag color="blue">{name}</Tag>
        );
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      key: 'action',
      width: 300,
      render: (_: unknown, record: ApprovalInstanceView) => {
        const pendingTask = activeRole === 'TODO' ? myPendingTask(record) : null;
        return (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => openDetail(record)}>
              详情
            </Button>
            {activeRole === 'APPLIED' && record.status === 'PENDING' && canApply && (
              <Popconfirm
                title="确认撤回该审批申请？"
                okText="确定"
                cancelText="取消"
                onConfirm={() => void handleWithdraw(record)}
              >
                <Button type="link" size="small">
                  撤回
                </Button>
              </Popconfirm>
            )}
            {pendingTask && canProcess && (
              <>
                <Button type="link" size="small" onClick={() => openAction('approve', record, pendingTask)}>
                  审批通过
                </Button>
                <Button type="link" size="small" onClick={() => openAction('reject', record, pendingTask)}>
                  驳回
                </Button>
                <Button hidden={['SOP_REVIEW','QUALITY_ANALYSIS'].includes(record.businessType)} type="link" size="small" onClick={() => openForward(pendingTask)}>
                  转交
                </Button>
                <Button hidden={['SOP_REVIEW','QUALITY_ANALYSIS'].includes(record.businessType)} type="link" size="small" onClick={() => openAddSigners(pendingTask)}>
                  加签
                </Button>
              </>
            )}
          </Space>
        );
      },
    },
  ];

  // SPEC-016 Task 4：节点列移除——详情弹窗已按 nodeName 分组，节点上下文由分组头承载。
  const taskColumns = [
    { title: '审批人', dataIndex: 'assigneeId', key: 'assigneeId', width: 120 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: ApprovalTaskStatus) => {
        const meta = TASK_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    { title: '意见', dataIndex: 'remark', key: 'remark', render: (value: string | null) => value || '-' },
    {
      title: '处理时间',
      dataIndex: 'processedAt',
      key: 'processedAt',
      width: 130,
      render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'),
    },
    // SPEC-019 Task 2：详情任务表转交——仅当前用户（assigneeId=actor）的 PENDING 任务行可转交（approval.process 门控）。
    // SPEC-020 Task 2：同列增「加签」（同 Modal 形态，仅当前用户 PENDING 行；:id=taskId 同节点追加审批人）。
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: unknown, task: ApprovalTaskView) => {
        const isMyPending = task.status === 'PENDING' && !!currentUserId && task.assigneeId === currentUserId;
        return canProcess && isMyPending && !['SOP_REVIEW','QUALITY_ANALYSIS'].includes(activeRecord?.businessType??'') ? (
          <>
            <Button type="link" size="small" onClick={() => openForward(task)}>
              转交
            </Button>
            <Button type="link" size="small" onClick={() => openAddSigners(task)}>
              加签
            </Button>
          </>
        ) : null;
      },
    },
  ];

  // SPEC-016 Task 4：详情弹窗任务区——节点进度链（currentNode 标记当前分组）+ tasks 按 nodeName 分组渲染。
  const renderTaskGroups = (record: ApprovalInstanceView): React.ReactNode => {
    const groups = groupTasksByNode(record.tasks);
    if (groups.length === 0) {
      return (
        <Table<ApprovalTaskView>
          columns={taskColumns}
          dataSource={[]}
          rowKey="id"
          size="small"
          pagination={false}
          locale={{ emptyText: '暂无审批任务' }}
        />
      );
    }
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {groups.map((group, index) => {
            const meta = nodeStateMeta(record, groups, index);
            const mode = nodeSchemaModeAt(record, index);
            return (
              <React.Fragment key={group.nodeName}>
                {index > 0 && <span style={{ color: 'rgba(0, 0, 0, 0.45)' }}>→</span>}
                <Space size={4}>
                  <span style={{ fontWeight: 600 }}>{group.nodeName}</span>
                  {/* SPEC-018 会签：nodeSchema 对应节点 mode==='ALL'（需节点内全部通过）→ 节点名旁「会签」Tag。 */}
                  {mode === 'ALL' && (
                    <Tag color="purple" data-testid={`node-countersign-${group.nodeName}`}>
                      会签
                    </Tag>
                  )}
                  <Tag color={meta.color} data-testid={`node-state-${group.nodeName}`}>
                    {meta.text}
                  </Tag>
                </Space>
              </React.Fragment>
            );
          })}
        </div>
        {groups.map((group) => (
          <div key={group.nodeName} data-testid={`node-group-${group.nodeName}`}>
            <div style={{ margin: '8px 0 4px', fontWeight: 600 }}>{group.nodeName}</div>
            <Table<ApprovalTaskView>
              columns={taskColumns}
              dataSource={group.tasks}
              rowKey="id"
              size="small"
              pagination={false}
              locale={{ emptyText: '暂无审批任务' }}
            />
          </div>
        ))}
      </div>
    );
  };

  // SPEC-017 Task 3：定义管理表（code/name/businessType/status/version/updatedAt/操作）。
  const manageColumns = [
    { title: '编码', dataIndex: 'code', key: 'code', width: 160 },
    { title: '名称', dataIndex: 'name', key: 'name', width: 180 },
    {
      title: '类型',
      dataIndex: 'businessType',
      key: 'businessType',
      width: 110,
      render: (value: string) => {
        const meta = BUSINESS_TYPE_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: string) => {
        const meta = DEFINITION_STATUS_META[value] ?? { text: value, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    { title: '版本', dataIndex: 'version', key: 'version', width: 80 },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 140,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: unknown, record: ApprovalDefinitionView) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openManageEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title={
              record.status === 'DISABLED' ? '确认启用该定义？' : '确认禁用该定义？禁用后不可发起新申请。'
            }
            okText="确定"
            cancelText="取消"
            onConfirm={() => void handleToggleDefinitionStatus(record)}
          >
            <Button type="link" size="small">
              {record.status === 'DISABLED' ? '启用' : '禁用'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const manageTabChildren = (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Space>
          <Button onClick={() => void handleExportDefinitions()}>导出</Button>
          <Button onClick={openImportPicker}>导入</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openManageCreate}>
            新建定义
          </Button>
        </Space>
        {/* SPEC-025：隐藏 file input（accept=".json"）——导入文件选择触发读取解析。 */}
        <input
          ref={importFileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          data-testid="definition-import-input"
          onChange={handleImportFileChange}
        />
      </div>
      <Table<ApprovalDefinitionView>
        columns={manageColumns}
        dataSource={definitionsManage}
        rowKey="code"
        loading={definitionsManageLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无定义' }}
        pagination={false}
      />
    </>
  );

  /** 列表 Tab 公共 children（APPLIED/TODO/DONE + ALL 全部审批 复用）：错误 Alert + 审批实例表。 */
  const renderListTab = (): React.ReactNode => (
    <>
      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="审批列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}
      <Table<ApprovalInstanceView>
        columns={columns}
        dataSource={instances}
        rowKey="id"
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无审批记录' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchInstances(activeRole, page, pageSize),
        }}
      />
    </>
  );

  /** SPEC-028 全组织视图（ALL Tab）children：筛选栏 + 导出按钮 + 共享表格（筛选参数透传）。 */
  const renderAllTab = (): React.ReactNode => (
    <>
      <Space style={{ marginBottom: 16 }} wrap data-testid="all-view-filter-bar">
        <Select<ApprovalBusinessType | undefined>
          allowClear
          placeholder="类型"
          value={allFilters.businessType}
          style={{ width: 140 }}
          data-testid="filter-business-type"
          onChange={(businessType) => setAllFilters((prev) => ({ ...prev, businessType }))}
          options={APPROVAL_BUSINESS_TYPES.map((type) => ({ value: type, label: type }))}
        />
        <Select<ApprovalInstanceStatus | undefined>
          allowClear
          placeholder="状态"
          value={allFilters.status}
          style={{ width: 140 }}
          data-testid="filter-status"
          onChange={(status) => setAllFilters((prev) => ({ ...prev, status }))}
          options={INSTANCE_STATUSES.map((status) => ({ value: status, label: status }))}
        />
        <Input
          allowClear
          placeholder="申请人 ID"
          value={allFilters.applicantId}
          style={{ width: 180 }}
          data-testid="filter-applicant"
          onChange={(event) => setAllFilters((prev) => ({ ...prev, applicantId: event.target.value }))}
        />
        <Input
          allowClear
          placeholder="标题关键词"
          value={allFilters.keyword}
          style={{ width: 180 }}
          data-testid="filter-keyword"
          onChange={(event) => setAllFilters((prev) => ({ ...prev, keyword: event.target.value }))}
          onPressEnter={() => void fetchInstances('ALL', 1, undefined, allFilters)}
        />
        <Button
          type="primary"
          data-testid="filter-apply"
          onClick={() => {
            void fetchInstances('ALL', 1, undefined, allFilters);
            void fetchStats(allFilters);
          }}
        >
          查询
        </Button>
        <Button
          data-testid="filter-reset"
          onClick={() => {
            setAllFilters({});
            void fetchInstances('ALL', 1);
            void fetchStats({});
          }}
        >
          重置
        </Button>
        <Button loading={exportingCsv} data-testid="export-csv" onClick={() => void handleExportAllCsv()}>
          导出 CSV
        </Button>
      </Space>
      {statsData && (
        <Row gutter={16} style={{ marginBottom: 16 }} data-testid="all-view-stats">
          <Col span={6}>
            <Statistic title="总量" value={statsData.total} data-testid="stats-total" />
          </Col>
          <Col span={6}>
            <Statistic title="在途" value={statsData.pendingCount} data-testid="stats-pending" />
          </Col>
          <Col span={6}>
            <Statistic title="已决" value={statsData.decidedCount} data-testid="stats-decided" />
          </Col>
          <Col span={6}>
            <Statistic
              title="平均决策时效"
              // avgDecisionHours 可 null（无已决）——AntD Statistic value 不接受 null，缺省 0。
              value={statsData.avgDecisionHours ?? 0}
              precision={1}
              suffix="h"
              data-testid="stats-avg-hours"
            />
          </Col>
        </Row>
      )}
      {listError && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message="审批列表加载失败"
          description={listError}
          style={{ marginBottom: 16 }}
        />
      )}
      <Table<ApprovalInstanceView>
        columns={columns}
        dataSource={instances}
        rowKey="id"
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无审批记录' }}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: listTotal,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => void fetchInstances('ALL', page, pageSize, allFilters),
        }}
      />
    </>
  );

  const tabItems: TabsProps['items'] = [
    ...TABS.map((tab) => ({ key: tab.key, label: tab.label, children: renderListTab() })),
    // SPEC-023 Task 2：全组织视图「全部审批」Tab——approval.manage 门控（无码用户不见）；
    // SPEC-028：ALL Tab 用 renderAllTab（筛选栏 + 导出按钮），筛选参数透传 fetchInstances。
    ...(canManage ? [{ key: 'ALL' as const, label: '全部审批', children: renderAllTab() }] : []),
    ...(canManage ? [{ key: 'MANAGE' as const, label: '定义管理', children: manageTabChildren }] : []),
  ];

  return (
    <div>
      {linkedError && (
        <Alert
          type="error"
          title={linkedError}
          action={
            <Button
              onClick={() => {
                setLinkedRetry((value) => value + 1);
                void fetchInstances(activeRole, listPage);
              }}
            >
              重新加载
            </Button>
          }
        />
      )}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}
      >
        <div style={{ fontWeight: 600, fontSize: 16 }}>
          审批中心 <Link to="/approval-ledger">业务台账 / 同步状态</Link> · <Link to="/approvals/visual">可视化审批</Link>
        </div>
        {canApply && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建申请
          </Button>
        )}
      </div>

      <Tabs activeKey={activeTab} onChange={handleTabChange} destroyOnHidden items={tabItems} />

      {/* 新建申请 */}
      <Modal
        title="新建审批申请"
        open={createOpen}
        onCancel={() => {
          if (materialsBusy) {
            message.info('请先完成附件上传或保存文档修改');
            return;
          }
          setCreateOpen(false);
        }}
        onOk={() => createForm.submit()}
        okButtonProps={{ disabled: materialsBusy }}
        confirmLoading={submitting}
        okText="确定"
        width={600}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="definitionCode"
            label="审批类型"
            rules={[{ required: true, message: '请选择审批类型' }]}
          >
            <Select
              aria-label="审批类型"
              placeholder="请选择审批类型"
              loading={definitionsLoading}
              onChange={handleDefinitionChange}
              options={definitions
                .filter((definition) => definition.businessType !== 'PAYROLL')
                .map((definition) => ({ value: definition.code, label: definition.name }))}
            />
          </Form.Item>
          <p>
            工资表审批请从 <Link to="/payroll">工资表与审批</Link> 发起。
          </p>
          <Button
            style={{ marginBottom: 16 }}
            onClick={() => {
              customTypeForm.resetFields();
              customTypeForm.setFieldValue('templateCode', watchedCode);
              setCustomTypeOpen(true);
            }}
          >
            自定义审批类型
          </Button>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, whitespace: true, message: '请填写标题' }]}
          >
            <Input aria-label="标题" maxLength={200} />
          </Form.Item>
          {getSchemaFields(selectedDefinition?.formSchema).map((field) => (
            <Form.Item
              key={field.key}
              name={field.key}
              label={field.label}
              rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : []}
            >
              {renderField(field)}
            </Form.Item>
          ))}
          <Divider>附件与证明材料</Divider>
          <ApprovalAttachments files={attachments} onChange={setAttachments} onBusy={setMaterialsBusy} />
        </Form>
      </Modal>

      <Modal
        title="自定义审批类型"
        open={customTypeOpen}
        onCancel={() => setCustomTypeOpen(false)}
        onOk={() => customTypeForm.submit()}
        confirmLoading={customTypeSaving}
        okText="创建并使用"
        destroyOnHidden
      >
        <Alert
          type="info"
          title="复制已有类型的表单和审批流程，保存为您可以反复使用的个人类型。"
          style={{ marginBottom: 16 }}
        />
        <Form
          form={customTypeForm}
          layout="vertical"
          initialValues={{ templateCode: watchedCode }}
          onFinish={createPersonalType}
        >
          <Form.Item
            name="name"
            label="自定义类型名称"
            rules={[{ required: true, whitespace: true, message: '请填写类型名称' }]}
          >
            <Input maxLength={100} placeholder="如工资和绩效发放、差旅补助" />
          </Form.Item>
          <Form.Item
            name="templateCode"
            label="参考表单与审批流程"
            rules={[{ required: true, message: '请选择参考类型' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={definitions.map((item) => ({ value: item.code, label: item.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 审批详情 */}
      <Modal
        title="审批详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={640}
        destroyOnHidden
      >
        {activeRecord && (
          <>
            {activeRecord.businessType==='QUALITY_ANALYSIS'&&typeof activeRecord.content.analysisId==='string'&&<p><Link to={'/quality/special-analyses/'+activeRecord.content.analysisId}>核验专项分析版本</Link></p>}
            {activeRecord.businessType === 'SOP_REVIEW' && typeof activeRecord.content.submissionId === 'string' && <p><Link to={'/sop/submissions/'+activeRecord.content.submissionId}>核验SOP成果版本与检查清单</Link></p>}
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="标题">{activeRecord.title}</Descriptions.Item>
              <Descriptions.Item label="类型">
                <Tag color={BUSINESS_TYPE_META[activeRecord.businessType]?.color}>
                  {activeRecord.formSnapshot?.name || businessTypeText(activeRecord.businessType)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="业务同步">
                {activeRecord.status !== 'APPROVED'
                  ? '审批通过后同步'
                  : activeRecord.businessSync?.status === 'SYNCED'
                    ? '已同步'
                    : activeRecord.businessSync?.reason || '待补同步'}{' '}
                <Link to="/approval-ledger">查看管理台账</Link>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={INSTANCE_STATUS_META[activeRecord.status]?.color}>
                  {INSTANCE_STATUS_META[activeRecord.status]?.text ?? activeRecord.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="申请人">{activeRecord.applicantId}</Descriptions.Item>
              <Descriptions.Item label="申请时间">
                {dayjs(activeRecord.createdAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              <Descriptions.Item label="内容">
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(activeRecord.content, null, 2)}
                </pre>
              </Descriptions.Item>
            </Descriptions>
            <Divider titlePlacement="left">附件与证明材料</Divider>
            <ApprovalAttachments key={activeRecord.id} instanceId={activeRecord.id} />
            <Space wrap style={{ marginTop: 16 }}>
              <Button
                onClick={() =>
                  void exportApprovalMaterial(activeRecord.id).catch((error) => message.error(error.message))
                }
              >
                导出审批材料 Word
              </Button>
              <Button
                onClick={() =>
                  void exportApprovalMaterial(activeRecord.id, true).catch((error) =>
                    message.error(error.message),
                  )
                }
              >
                打印 / 另存 PDF
              </Button>
              {canApply && !['SOP_REVIEW','QUALITY_ANALYSIS'].includes(activeRecord.businessType) &&
                activeRecord.applicantId === currentUserId &&
                ['WITHDRAWN', 'REJECTED'].includes(activeRecord.status) && (
                  <Button onClick={() => void reapply(activeRecord)}>修改后重新申请</Button>
                )}
            </Space>
            <Divider titlePlacement="left">审批任务</Divider>
            {renderTaskGroups(activeRecord)}
          </>
        )}
      </Modal>

      {/* 处理动作 */}
      <Modal
        title={actionModal === 'approve' ? '审批通过' : '驳回审批'}
        open={actionModal !== null}
        onCancel={() => {
          setActionModal(null);
          setActiveRecord(null);
          setActiveTask(null);
        }}
        onOk={() => void handleActionOk()}
        confirmLoading={submitting}
        okText={actionModal === 'reject' ? '确认驳回' : '确认通过'}
        okButtonProps={{ danger: actionModal === 'reject' }}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            actionModal === 'approve'
              ? '审批通过为高敏感操作（approval.process），通过后实例定稿，不可撤销。'
              : '驳回为高敏感操作，请确认后再提交。'
          }
        />
        <Form form={actionForm} layout="vertical">
          <Form.Item name="comment" label="审批意见（可选）">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {/* SPEC-019 Task 2：转交任务（approval.process）。目标 userId 必填；:id=taskId，转交不改变任务状态。 */}
      <Modal
        title="转交任务"
        open={forwardOpen}
        onCancel={() => {
          setForwardOpen(false);
          setActiveTask(null);
        }}
        onOk={() => void handleForwardOk()}
        confirmLoading={submitting}
        okText="确认转交"
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="转交后该任务由目标审批人处理，任务状态与节点不变。"
        />
        <Form form={forwardForm} layout="vertical">
          <Form.Item
            name="forwardToUserId"
            label="目标审批人 ID"
            rules={[{ required: true, whitespace: true, message: '请填写目标审批人 ID' }]}
          >
            <Input aria-label="目标审批人 ID" maxLength={100} placeholder="接收转交的审批人 userId" />
          </Form.Item>
        </Form>
      </Modal>

      {/* SPEC-020 Task 2：加签任务（approval.process）。目标 userIds 逗号分隔必填；:id=taskId，加签同节点追加审批人。 */}
      <Modal
        title="加签任务"
        open={addSignerOpen}
        onCancel={() => {
          setAddSignerOpen(false);
          setActiveTask(null);
        }}
        onOk={() => void handleAddSignersOk()}
        confirmLoading={submitting}
        okText="确认加签"
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="加签后目标审批人加入当前节点协同审批，任务状态与节点不变。"
        />
        <Form form={addSignerForm} layout="vertical">
          <Form.Item
            name="addSignerUserIds"
            label="加签目标审批人 ID（逗号分隔）"
            rules={[{ required: true, whitespace: true, message: '请填写加签目标审批人 ID' }]}
          >
            <Input
              aria-label="加签目标审批人 ID（逗号分隔）"
              maxLength={500}
              placeholder="如 user-2, user-3"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 定义管理（approval.manage）：新建/编辑定义。code/businessType 仅新建可改（后端 update 白名单不含）；formSchema/nodeSchema 简化 JSON 文本编辑。 */}
      <Modal
        title={editingDefinition ? '编辑审批定义' : '新建审批定义'}
        open={manageModalOpen}
        onCancel={() => setManageModalOpen(false)}
        onOk={() => manageForm.submit()}
        confirmLoading={manageSubmitting}
        okText="确定"
        width={640}
        destroyOnHidden
      >
        <Form form={manageForm} layout="vertical" onFinish={(values) => void handleManageSubmit(values)}>
          <Form.Item
            name="code"
            label="编码"
            rules={[{ required: true, whitespace: true, message: '请填写编码' }]}
          >
            <Input
              aria-label="编码"
              maxLength={100}
              disabled={!!editingDefinition}
              placeholder="如 EXPENSE_DOC_FEE"
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, whitespace: true, message: '请填写名称' }]}
          >
            <Input aria-label="名称" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="businessType"
            label="业务类型"
            rules={[{ required: true, message: '请选择业务类型' }]}
          >
            <Select
              aria-label="业务类型"
              disabled={!!editingDefinition}
              options={APPROVAL_BUSINESS_TYPES.filter(type=>!['SOP_REVIEW','QUALITY_ANALYSIS'].includes(type)).map((type) => ({
                value: type,
                label: BUSINESS_TYPE_META[type]?.text ?? type,
              }))}
            />
          </Form.Item>
          {editingDefinition && (
            <Form.Item name="version" label="版本">
              <Input aria-label="版本" disabled />
            </Form.Item>
          )}
          <Form.Item
            name="formSchemaJson"
            label="表单 Schema（JSON）"
            rules={[{ required: true, message: '请填写表单 Schema' }]}
          >
            <Input.TextArea
              aria-label="表单 Schema（JSON）"
              rows={3}
              placeholder='{"fields":[{"key":"reason","label":"事由","type":"text","required":true}]}'
            />
          </Form.Item>
          <Form.Item
            name="approverRuleType"
            label="审批人类型"
            rules={[{ required: true, message: '请选择审批人类型' }]}
          >
            <Select
              aria-label="审批人类型"
              options={[
                { value: 'ROLE', label: '角色' },
                { value: 'USER', label: '指定成员' },
                { value: 'SUPERVISOR', label: '直属上级' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="approverRuleValue"
            label="审批人取值（逗号分隔；直属上级无需填写）"
            rules={[{ required: false }]}
          >
            <Input aria-label="审批人取值（逗号分隔）" placeholder="如 HR, SEAL_ADMIN（直属上级留空）" />
          </Form.Item>
          <Form.Item name="nodeSchemaJson" label="节点 Schema（可选 JSON）">
            <Input.TextArea
              aria-label="节点 Schema（可选 JSON）"
              rows={2}
              placeholder='留空=单节点（顶层审批人）；或 [{"name":"主管初审","approverRule":{"type":"ROLE","roleCodes":["MANAGER"]}}]'
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ApprovalCenterPage;
