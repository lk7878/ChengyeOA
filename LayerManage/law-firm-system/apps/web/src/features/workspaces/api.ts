import request from '@/api/request';
import { runtimeSession } from '@/features/auth/runtime-session';
export async function get<T>(url: string): Promise<T> {
  return (await request.get<{ data: T }>('/v1' + url, { suppressGlobalError: true })).data;
}
export async function post<T>(url: string, body: unknown, key: string = crypto.randomUUID(), timeout?: number): Promise<T> {
  return (
    await request.post<{ data: T }>('/v1' + url, body, {
      suppressGlobalError: true,
      ...(timeout === undefined ? {} : { timeout }),
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
  COLLAB_FIELD_PROTECTED: '此字段用于标识、人员关联或业务流程，不能停用或删除；可在视图配置中隐藏。',
  COLLAB_FIELD_DEPENDENCIES: '字段仍有依赖，或属于受保护字段。请重新核对并处理依赖后操作。',
  COLLAB_FIELD_DELETE_CHANGED: '字段或数据范围已变化，请重新打开删除核对窗口。',
  PERSONAL_FOLDER_DOWNLOAD_FORBIDDEN: '文件夹内存在无权读取的内容，无法打包下载，请联系所有者核对分享权限。',
  PERSONAL_FOLDER_DOWNLOAD_CHANGED: '打包期间文件或权限发生变化，请重新下载。',
  PERSONAL_FOLDER_DOWNLOAD_LIMIT: '单次打包最多支持 10000 项、2 GB，请进入子文件夹分别下载。',
  PERSONAL_FOLDER_DOWNLOAD_BUSY: '当前打包任务较多，请稍后重试。',
  PERSONAL_ORGANIZE_OWNER_ONLY: '只能移动或复制自己所有的资料，并选择自己的文件夹。',
  PERSONAL_ORGANIZE_MIXED_OWNER: '文件夹内含有其他人所有的资料，无法整夹整理，请单独选择自己的内容。',
  PERSONAL_ORGANIZE_INVALID_TARGET: '目标目录不可用，不能移入自身、下级目录或超过 12 层的目录。',
  PERSONAL_ORGANIZE_CHANGED: '文件或共享权限已变化，请关闭整理窗口，刷新列表后重新选择并核对。',
  PERSONAL_ORGANIZE_LIMIT: '单次整理最多 1000 项，复制内容最多 2 GB，请分批操作。',
  COLLAB_ASSIGNMENT_ORGANIZATION_IN_USE: '现有跟进人不在所选律所体系，请先处理相关客资的人员分配。',
  COLLAB_ASSIGNMENT_ORGANIZATION_FORBIDDEN: '请选择本工作区或您负责的组织。',
  COLLAB_ASSIGNMENT_FIELD_REQUIRED: '跟进人用于客资分配和数据权限，不能停用该字段。',
  COLLAB_ASSIGNMENT_FIELD_DUPLICATE: '本表已有跟进人分配字段，请配置现有字段。',

  MANAGED_ROLE_PROTECTED: '智慧办案使用者是专用角色，请通过成员分配或移除资格。',
  SMART_CASE_ACCESS_ROLE_REQUIRED: '请分配“智慧办案使用者”角色，不能将其使用资格复制到岗位角色。',
  AUTHORIZATION_IN_USE: '名称或编码已存在，或对象仍在使用中，请核对后重试。',
  AUTHORIZATION_INPUT_INVALID: '提交内容不符合授权规则，请核对填写内容和授权选项。',
  PRIVILEGE_ESCALATION_BLOCKED: '所选授权涉及受保护的角色或权限，请调整授权选项。',

  PERSONAL_FILE_PURGE_FAILED: '文件清理未完成，已禁止恢复；请在回收站点击“重试彻底删除”。',
  PERSONAL_FILE_PURGE_REFERENCED: '文件存储仍被其他文件引用，未执行删除，请联系管理员核对。',
  COLLAB_CUSTOMER_ROUTE_UNAVAILABLE: '对应律师客资表或同步字段不可用，客户修改未保存，请联系管理员检查。',
  COLLAB_CUSTOMER_ROUTE_DUPLICATE: '客资表存在重复客户编号，客户修改未保存，请联系管理员核对。',
  COLLAB_CUSTOMER_ROUTE_REQUIRED_FIELD: '客资表有无法自动填写的必填字段，客户修改未保存，请联系管理员检查。',
  ADMIN_HIGH_RISK_ONLY: '此操作仅限有权限的管理员执行，请联系管理员。',
  STEP_UP_CANCELLED: '已取消操作，数据未变更。',
  STEP_UP_REQUIRED: '此管理员高风险操作需要二次验证。',
  COLLAB_INVALID_NAVIGATION:'菜单节点配置无效，请检查父节点、层级或页面绑定。',
  COLLAB_TABLE_NAME_CONFLICT:'目标目录已有同名工作表，请先调整名称。',
  MEDICAL_LINKED_FIELD_READONLY:'客户信息由关联的跟进记录回填，不能直接修改；请先清空关联。',
  COMMENT_MENTION_FORBIDDEN: '被提及的成员没有查看本行的权限，请重新选择。',
  COMMENT_VERSION_CONFLICT: '评论已被修改，请刷新后重新编辑。当前输入已保留。',
  CALENDAR_NOT_FOUND: '日程不存在或你没有查看权限。',
  CALENDAR_INVALID_TIME: '请填写有效时间，结束时间必须晚于开始时间。',
  CALENDAR_VERSION_CONFLICT: '日程安排已变化，请重新打开后再操作。',
  CALENDAR_PRIVATE_INVITE: '邀请其他成员时，请将可见范围改为受邀成员或公开。',
  CALENDAR_INVALID_INVITEE: '有成员账号已停用或不存在，请重新选择。',
  CALENDAR_INVALID_REMINDERS: '最多设置10个提醒，支持提前0分钟至28天。',
  CALENDAR_INVALID_LINK: '请选择完整的关联记录。',
  CASE_CONFLICT_REVIEW_REQUIRED: '案件涉及潜在利益冲突，请进入案件修改表单核验并填写排除理由。',
  COLLAB_ARCHIVE_NUMBER_DUPLICATE: '该档号已存在，请使用其他档号；恢复记录前也需先解决档号重复。',
  COLLAB_MEETING_NUMBER_DUPLICATE: '本表已有相同的会议编号，请修改编号或使用已有记录。',
  COLLAB_NONNEGATIVE_INTEGER_REQUIRED: '份数或人数必须为大于等于0的整数。',
  COLLAB_INVALID_REVIEW: '请选择审核结果并填写审核原因。',
  COLLAB_REVIEW_REASON_REQUIRED: '驳回申请时必须填写审核原因。',
  FINANCE_RECEIPT_HAS_REFUND: '此收款已有退款申请或执行记录，不能修改或删除，请先核对关联退费。',
  LIFECYCLE_FINANCE_LOCKED: '关联退费已进入财务审批或执行流程，不能修改申请或删除来源记录。',
  REFUND_EXECUTION_DETAILS_REQUIRED: '请先填写实际退费金额、退费时间并上传凭证，再执行退款。',
  REFUND_AMOUNT_EXCEEDED: '退费金额不能超过申请金额或合同可退的已确认收款余额。',
  REFUND_STATE_INVALID: '请先完成退款审批；执行后的退款记录不可再修改。',
  PAYMENT_AMOUNT_EXCEEDED: '收款金额超过合同或收款计划的可收余额，请核对后重试。',
  LIFECYCLE_NEGOTIATION_IN_USE: '谈案已经签约或存在关联合同，不能删除；请保留业务链路。',
  LIFECYCLE_REFUND_CONTRACT_UNAVAILABLE: '请先为案件关联有效合同，并确认具有该合同的退费登记权限。',
  LIFECYCLE_TABLE_HAS_RECORDS: '关联表中有业务历史，请使用行删除或归档表，以保留关联和恢复记录。',
  LIFECYCLE_TABLE_NOT_EMPTY: '该表已有记录，不能直接转换。请新建关联表后核对迁移，原记录会保留。',
  LIFECYCLE_FIELD_NAME_CONFLICT: '已有同名字段，请先重命名后配置关联。',
  LIFECYCLE_PARENT_UNAVAILABLE: '关联售后不存在、已删除或不可访问，请先恢复或重新选择。',
  LIFECYCLE_REFUND_STATE: '只有“协商未果 / 需退款”的售后记录可以登记退费。',
  LIFECYCLE_CASE_UNAVAILABLE: '关联案件已删除或不在你的案件权限范围内。',
  LIFECYCLE_HAS_CHILDREN: '已有下游退费记录，不能删除、改绑案件或撤回需退款状态；请先处理下游关联。',
  LIFECYCLE_DUPLICATE_CASE: '本表已有该案件的记录（可能在回收站），请编辑或恢复原记录。',
  LIFECYCLE_INVALID_AMOUNT: '退费金额必须大于零且最多两位小数。',
  LIFECYCLE_NEGOTIATION_UNAVAILABLE: '所选谈案不在权限范围内或与客户不一致。',
  LIFECYCLE_NEGOTIATION_NOT_SIGNED: '请先将谈案完结为已签约，再发起关联的合同。',
  LIFECYCLE_CONTRACT_NOT_EFFECTIVE: '关联合同必须已生效，且合同客户与案件客户一致。',
  LIFECYCLE_CONTRACT_HAS_CASE: '该合同已有案件（含回收站记录），请打开已有案件继续办理。',

  LEAD_IN_USE: '线索已转为客户，或存在邀约、SOP任务等关联，请先处理关联后再删除。',
  LEAD_PHONE_INVALID: '联系电话格式不正确，请填写有效的电话号码。',
  CONTRACT_GRID_STATE_INVALID:
    '仅草稿合同可直接修改；仅草稿或已作废合同可删除。审批、签署或生效中的合同请通过详情办理。',
  CONTRACT_GRID_IN_USE:
    '合同已有签署、收款计划、收款、开票、退款、案件、分析委托或补充协议关联，不能直接修改或删除。',
  RECEIVABLE_PLAN_MISMATCH: '合同金额与约定的收款计划不一致，请先核对收款约定。',
  CASE_HANDLING_LAWYER_UNAVAILABLE: '请选择当前组织范围内有效的承办律师。',
  VALIDATION_FAILED: '输入内容不符合要求，请检查必填字段及金额格式。',
  VERSION_CONFLICT: '记录已被其他人修改，请刷新后重试。',
  CASE_STATE_INVALID: '案件已结案或归档，不能直接修改或删除。',
  CASE_IN_USE: '案件存在合同、费用或其他业务关联，请先完成业务处理再删除。',
  CASE_VERSION_CONFLICT: '案件已被其他人修改，请刷新后重试。',
  DRIVE_FILE_CLEANUP_FAILED: '文档附件清理未完成，请重试确认删除；已完成的删除不会重复执行。',
  DRIVE_SHORTCUT_EXISTS: '此位置已经存在该资源的快捷方式。',
  DRIVE_PREVIEW_STALE: '目录或授权规则已变化，请重新预览后确认。',
  DRIVE_STATE_CONFLICT: '资源状态已变化，请刷新目录后重试。',
  DRIVE_PARENT_UNAVAILABLE: '原目录或目标目录仍在回收站，请先恢复上级目录。',
  DRIVE_SAME_PARENT: '请选择不同的目标目录。',
  DRIVE_TARGET_REQUIRED: '请选择移动目标。',
  DRIVE_CYCLE: '不能移动到资源自身或其子文件夹。',
  DRIVE_SUBTREE_LIMIT: '每次最多处理 500 个目录资源，请分批整理。',
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
  WORKSHEET_USE_ROLE_CENTER: '请在管理中心的角色权限中配置工作表权限。',
  COLLAB_GRANT_EXCEEDS_ACCESS: '所选授权超过你可转授的范围，请缩小权限、记录范围或字段范围。',
  COLLAB_IMPORT_UNSUPPORTED: '此表包含业务流程，请使用记录录入完成业务校验。批量导入支持独立记录表。',
  COLLAB_EXPORT_LIMIT: '导出超过10000行，请通过筛选缩小范围。',
  MODULE_RETIRED: '该模块已停用，历史记录仅供查阅',
  WORKSHEET_PREVIEW_TARGET_DENIED: '当前预览对象在此工作表或所选视图没有可用权限。可切换成员、角色或工作表查看。',
  WORKSHEET_PREVIEW_VIEWER_DENIED: '当前管理员没有读取此工作表的权限，无法预览其数据。',
  WORKSHEET_PREVIEW_READONLY: '预览模式仅支持读取数据。',
  COLLAB_INVALID_ACCESS: '权限设置无效，请核对角色、视图和字段后重试。',
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
  COLLAB_REFERENCED_FIELD: '字段仍被视图、公式、授权或业务规则引用，请先调整引用。',
  COLLAB_REFERENCED_TABLE: '其他数据表仍在关联此表，请先处理关联。',
  COLLAB_NOT_FOUND: '数据不存在、已归档或不在你的权限范围内。',
  COLLAB_MODULE_WORKSPACE_MISMATCH: '工作区与业务模块不匹配，请选择本模块工作区。',
  COLLAB_INVENTORY_PRODUCT_DUPLICATE: '库存表中已存在相同的产品名称，请使用已有产品记录；如需恢复已删除记录，请先处理重名记录。',
  COLLAB_INVENTORY_MOVEMENTS_REQUIRED: '请先在同一工作表中创建标准入库明细表和出库明细表。',
  COLLAB_INVENTORY_REGISTER_REQUIRED: '请先在同一工作表中创建对应的领用明细表，统计表将自动汇总其数据。',
  COLLAB_READONLY_FIELD: '此字段只读。',
  COLLAB_IDEMPOTENCY_CONFLICT: '重试内容发生变化，请重新发起操作。',
  COLLAB_DEFAULT_VIEW_REQUIRED: '必须保留默认总表。',
  COLLAB_MEMBER_UNAVAILABLE: '该成员不在可选范围内。',
  COLLAB_PRIVATE_FIELD_QUERY: '敏感信息和派生年龄不支持筛选、分组或排序，请使用姓名、部门等字段查询。',
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
