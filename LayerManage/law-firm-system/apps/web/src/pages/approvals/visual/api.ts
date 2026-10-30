import request from '@/api/request';
export {
  calculate,
  matches,
  fieldMode,
  validateSchema,
  validateWorkflowName,
  recipientRules,
  WorkflowError,
  validateValues,
} from '../../../../../server/app/domain/workflow/schema';
export type {
  WorkflowSchema,
  WorkflowLocation,
  AssigneeRule,
  FormField,
  FlowNode,
  FlowEdge,
  Condition,
  FieldMode,
  Values,
} from '../../../../../server/app/domain/workflow/schema';
import type { WorkflowSchema, Values } from '../../../../../server/app/domain/workflow/schema';
export interface Option {
  id: string;
  name: string;
}
export interface Options {
  users: Option[];
  roles: Option[];
  hooks: string[];
}
export interface Definition {
  id?: string;
  name: string;
  schema: WorkflowSchema;
  version: number;
  revision: number;
  enabled: boolean;
}
export interface Instance {
  id: string;
  definitionId: string;
  correctionOf?: string;
  canCorrect?: boolean;
  title: string;
  applicantId: string;
  status: string;
  currentNode: string;
  version: number;
  visit: number;
  definitionVersion: number;
  content: Values;
  snapshot: WorkflowSchema;
  editable: string[];
  syncStatus: string;
  syncError?: string;
  targetRecordId?: string;
  createdAt: string;
  tasks: Array<{
    id: string;
    nodeId: string;
    visit: number;
    assigneeId: string;
    status: string;
    remark?: string;
    createdAt: string;
    processedAt?: string;
  }>;
  logs: Array<{
    id: string;
    nodeId: string;
    actorId: string;
    action: string;
    remark?: string;
    createdAt: string;
  }>;
  deliveries: Array<{ id: string; status: string; attempts: number; error?: string }>;
}
export interface TableSchema {
  table: { id: string; baseId: string; schemaVersion: number; source: string; lifecycleKind?: string };
  fields: Array<{
    id: string;
    name: string;
    type: string;
    writable: boolean;
    options: Record<string, unknown>;
  }>;
}
export const get = async <T>(path: string) =>
  (await request.get<{ data: T }>('/v1' + path, { suppressGlobalError: true })).data;
export const post = async <T>(path: string, data: unknown, key = crypto.randomUUID()) =>
  (
    await request.post<{ data: T }>('/v1' + path, data, {
      suppressGlobalError: true,
      headers: { 'Idempotency-Key': key },
    })
  ).data;
export const errorText = (e: unknown) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  (e instanceof Error ? e.message : '操作失败');
export async function upload(file: File) {
  const data = new FormData();
  data.append('file', file);
  return (
    await request.post<{ data: { id: string; name: string } }>('/v1/workflows/files', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
      suppressGlobalError: true,
      timeout: 60000,
    })
  ).data;
}
export async function download(id: string, instance?: string) {
  const file = (
    await request.get<{ data: { name: string; mime: string; base64: string } }>(
      `/v1/workflows/files/${id}${instance ? '?instance=' + encodeURIComponent(instance) : ''}`,
      { timeout: 60000, suppressGlobalError: true },
    )
  ).data;
  const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const labels: Record<string, string> = {
  START: '发起',
  APPROVAL: '审批',
  CC: '抄送',
  BRANCH: '条件分支',
  END: '结束',
  PENDING: '待审批',
  WAITING: '等待前序',
  APPROVED: '已通过',
  AUTO_APPROVED: '超时同意',
  SKIPPED: '同人跳过',
  REJECTED: '已驳回',
  WITHDRAWN: '已撤回',
  RETURNED: '已退回',
  FORWARDED: '已转办',
  CANCELLED: '已取消',
  SYNCED: '已回写',
  FAILED: '失败',
  NONE: '无需回写',
  SENT: '已投递',
  SENDING: '投递中',
  APPLY: '发起申请',
  ENTER: '进入节点',
  COMPLETED: '流程结束',
  APPROVE: '同意',
  REJECT: '驳回',
  RETURN: '退回',
  FORWARD: '转办',
  ADD: '加签',
  RESUBMIT: '重新提交',
  WITHDRAW: '撤回',
  RETRY_SYNC: '重试回写',
  TIMEOUT_APPROVE: '超时自动同意',
  SKIP_REPEATED: '同人自动跳过',
  RULE_APPROVE: '规则自动同意',
  RULE_REJECT: '规则自动驳回',
  CORRECTION: '发起更正',
  CORRECTION_STARTED: '关联更正申请',
};
export const fieldLabels: Record<string, string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字 / 金额',
  date: '日期',
  select: '单选',
  multi: '多选',
  file: '附件',
  user: '人员',
  relation: '关联业务数据',
  detail: '明细表',
  moneyUpper: '金额大写',
  formula: '公式计算',
};
export const starter = (): WorkflowSchema => ({
  fields: [],
  nodes: [
    { id: 'start', type: 'START', name: '发起申请', x: 40, y: 130 },
    {
      id: 'review',
      type: 'APPROVAL',
      name: '审批',
      x: 290,
      y: 130,
      rule: { type: 'USER', ids: [] },
      mode: 'ALL',
    },
    { id: 'end', type: 'END', name: '结束', x: 540, y: 130 },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'review' },
    { id: 'e2', from: 'review', to: 'end' },
  ],
});
