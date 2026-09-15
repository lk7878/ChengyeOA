import request from '@/api/request';
import { runtimeSession } from '@/features/auth/runtime-session';
export async function get<T>(url: string): Promise<T> {
  return (await request.get<{ data: T }>('/v1' + url, { suppressGlobalError: true })).data;
}
export async function post<T>(url: string, body: unknown, key: string = crypto.randomUUID()): Promise<T> {
  return (
    await request.post<{ data: T }>('/v1' + url, body, {
      suppressGlobalError: true,
      headers: { 'Idempotency-Key': key },
    })
  ).data;
}
export async function patch<T>(url: string, body: unknown, key: string = crypto.randomUUID()): Promise<T> {
  return (
    await request.patch<{ data: T }>('/v1' + url, body, {
      suppressGlobalError: true,
      headers: { 'Idempotency-Key': key },
    })
  ).data;
}
const messages: Record<string, string> = {
  DRIVE_DEPTH_LIMIT: '文件夹最多支持 8 层，请选择上级目录。',
  DRIVE_VERSION_CONFLICT: '资源已被修改，请重新打开后重试。',
  COLLAB_DIRECTORY_CONFLICT: '目录已被其他成员修改，已重新加载，请核对后重试。',
  COLLAB_INVALID_DIRECTORY_ORDER: '可管理的表已变化，请重新加载目录。',
  COLLAB_USE_DIRECTORY_ORDER: '请通过目录的拖拽或上移/下移操作调整顺序。',
  COLLAB_BATCH_LIMIT: '每批最多 100 行、1000 个单元格，请缩小粘贴范围。',
  COLLAB_BATCH_EMPTY: '粘贴记录不能为空。',
  COLLAB_BATCH_DUPLICATE: '同一批次不能重复修改同一记录。',
  COLLAB_FIELD_UNAVAILABLE: '字段已不可用或没有访问权限，请重新加载。',
  LEAD_STATE_TRANSITION_INVALID: '当前状态不能转为目标状态，请核对最新记录。',
  LEAD_NOT_FOUND: '线索不存在或不在你的业务权限范围内。',
  LEAD_ASSIGN_TARGET_NOT_FOUND: '该负责人已不可用，请重新选择。',
  COLLAB_CANNOT_GRANT_ACCESS_ADMIN: '只有工作区负责人可以授予授权管理能力；不能修改自己的授权。',
  COLLAB_INVALID_ACCESS_ADMIN: '授权管理员需要管理角色、全部记录范围且没有字段限制。',
  COLLAB_MEMBER_CONFLICT: '岗位或成员授权已变化，请重新打开分享窗口。',
  COLLAB_SENSITIVE_QUERY_UNSUPPORTED: '敏感字段不支持筛选、排序或分组，请选择其他字段。',
  COLLAB_ACCESS_CONFLICT: '权限已被修改，请关闭后重新打开权限窗口，再保存。',
  COLLAB_USE_BUSINESS_ACTION: '请通过业务入口办理，核心业务字段不支持直接修改。',
  COLLAB_RECORD_CONFLICT: '这条记录已被其他成员修改。请核对最新值后再提交。',
  COLLAB_SCHEMA_CONFLICT: '表字段已经变化，请重新打开编辑器。',
  COLLAB_VIEW_CONFLICT: '视图已被修改，请重新加载后保存。',
  COLLAB_FORBIDDEN: '你没有此项操作权限。',
  COLLAB_NAME_OR_ID_CONFLICT: '名称已存在，请换一个名称。',
  COLLAB_REQUIRED_FIELD: '请补充必填字段。',
  COLLAB_INVALID_NUMBER: '请输入有效数字。',
  COLLAB_REQUIRED_BACKFILL_REQUIRED: '已有记录，请先补齐数据再设置必填。',
  COLLAB_FIELD_MIGRATION_REQUIRED: '此字段已有数据，修改类型需要数据迁移。',
  COLLAB_REFERENCED_FIELD: '字段仍被视图引用，请先调整引用。',
  COLLAB_REFERENCED_TABLE: '其他数据表仍在关联此表，请先处理关联。',
  COLLAB_NOT_FOUND: '数据不存在、已归档或不在你的权限范围内。',
  COLLAB_READONLY_FIELD: '此字段只读。',
  COLLAB_IDEMPOTENCY_CONFLICT: '重试内容发生变化，请重新发起操作。',
  COLLAB_DEFAULT_VIEW_REQUIRED: '必须保留默认总表。',
  COLLAB_MEMBER_UNAVAILABLE: '该成员不在可选范围内。',
  COLLAB_INVALID_DATE: '日期格式不正确。',
  COLLAB_INVALID_CURRENCY: '金额最多保留两位小数。',
};
export function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  const code = e.response?.data?.message || e.message || '';
  return (
    messages[code] ||
    (code.startsWith('COLLAB_') ? '操作未通过校验，请检查字段和权限。' : '请求未完成，请检查连接后重试。')
  );
}
export function errorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } }).response?.status;
}

export async function authenticatedFetch(url: string, signal?: AbortSignal): Promise<Response> {
  let response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + runtimeSession.getAccessToken() },
    signal,
    credentials: 'include',
  });
  if (response.status === 401) {
    const token = await runtimeSession.refreshOnce();
    response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      signal,
      credentials: 'include',
    });
  }
  return response;
}

export async function streamEvents(
  baseId: string,
  signal: AbortSignal,
  onEvent: (kind: string, data: unknown) => void,
  tableId?: string,
): Promise<void> {
  const response = await authenticatedFetch(
    '/api/v1/collaboration/events?baseId=' +
      encodeURIComponent(baseId) +
      (tableId ? '&tableId=' + encodeURIComponent(tableId) : ''),
    signal,
  );
  if (response.status === 403 || response.status === 404) {
    onEvent('revoked', {});
    return;
  }
  if (!response.ok || !response.body) throw new Error('COLLAB_CONNECTION_FAILED');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const kind = frame
          .split('\n')
          .find((l) => l.startsWith('event: '))
          ?.slice(7);
        const payload = frame
          .split('\n')
          .find((l) => l.startsWith('data: '))
          ?.slice(6);
        if (kind && payload) onEvent(kind, JSON.parse(payload));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
