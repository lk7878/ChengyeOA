import { message } from 'antd';

const reported = new WeakSet<object>();
const messages: Record<string, string> = {
  HARNESS_TICKET_INVALID: '本机助手授权已失效，请重新连接',
  INVENTORY_NOT_FOUND: '物品不存在，请刷新列表',
  INVENTORY_DISABLED: '该物品已停用，不能登记新的库存变动',
  INVENTORY_QUANTITY_INVALID: '数量须在有效范围内，最多三位小数；入出库数量必须大于零',
  INVENTORY_INSUFFICIENT: '库存不足，无法领用该数量；当前输入已保留',
  INVENTORY_KEY_CONFLICT: '该登记已提交，不能使用同一单号提交不同内容，请核对已有流水',
  INVENTORY_REASON_REQUIRED: '请填写领用用途或盘点差异原因',
  INVENTORY_RECIPIENT_INVALID: '领用人已离职或缺少有效主岗位，请选择在职员工',
  INVENTORY_UNIT_FROZEN: '已有历史记录，不能更换物品类型或计量单位；请另建物品档案',
  INVENTORY_EXPORT_TOO_LARGE: '导出结果超过一万行，请缩小日期或物品筛选范围',
  FINANCE_CASE_MISMATCH: '所选合同与当前案件编号不一致，请选择该案件的合同或清除案件筛选后登记',
  PAYROLL_BATCH_REQUIRED: '请从绩效管理的工资表选择已保存文件发起工资审批',
  APPROVAL_FILE_INVALID: '文件格式不支持或内容损坏，请使用图片、PDF、XLSX、DOCX；旧版 XLS/DOC 请先另存为新格式',
  APPROVAL_FILE_TOO_LARGE: '附件不能为空，且单个文件不能超过 10 MB',
  APPROVAL_FILE_EXTERNAL_CONTENT: '文档含外部链接、嵌入对象或宏，请移除后另存为普通文档再上传',
  APPROVAL_FILE_NOT_FOUND: '文件不存在或您无权查看',
  APPROVAL_FILE_FROZEN: '已提交材料或被修改版引用的原件不可移除',
  APPROVAL_FILE_BIND_INVALID: '部分附件已被提交或无法使用，请核对附件后重试，当前输入已保留',
  APPROVAL_APPLY_KEY_CONFLICT: '本次申请已提交，请刷新审批列表核对后重新发起',
  VALIDATION_FAILED: '输入内容不符合要求，请检查字段格式和必填项，当前输入已保留',
  LEAD_PHONE_INVALID: '电话格式不正确，请填写至少 7 位数字，可包含空格、横线、括号和加号',
  ACTOR_EMPLOYEE_UNBOUND: '当前账号尚未绑定员工档案，请先完成绑定',
  APPOINTMENT_CONFLICT: '预约时间或资源冲突，请选择其他时间',
  MASTER_DATA_CODE_CONFLICT: '编码已存在，请使用其他编码',
  ORGANIZATION_SORT_CONFLICT: '排序号已被其他组织占用，请刷新后选择其他号码，当前输入已保留',
  SUPER_ADMIN_REQUIRED: '仅系统超级管理员可以执行此操作',
  ORGANIZATION_DELETE_IN_USE: '该组织存在下级、岗位或历史关联，无法删除。请先处理关联；需保留历史时请使用停用',
  ORGANIZATION_MANAGER_INVALID: '负责人不存在或已离职，请重新选择在职员工',
  POSITION_DELETE_IN_USE: '该岗位存在当前或历史任职关联，无法删除；请保留岗位并按需停用',
  EMPLOYEE_DELETE_IN_USE: '该员工仍有未结案件、未完成线索、在任下属或负责人职责，请先完成移交后再删除',
  EMPLOYEE_DELETE_SELF: '不能删除当前登录账号绑定的员工档案，请由其他超级管理员处理',
  VERSION_CONFLICT: '数据已被其他操作修改，请刷新后重试',
  MASTER_DATA_IN_USE: '该记录仍被其他数据使用，暂时无法执行此操作',
  ORGANIZATION_HIERARCHY_INVALID: '组织层级不符合要求，请选择合适的上级组织和组织类型',
  ORGANIZATION_CYCLE: '上级组织不能是当前组织或其下级组织',
  TRUST_ROOT_PROTECTED: '系统根组织或初始管理员受保护，无法执行此操作',
  ASSIGNMENT_ORGANIZATION_MISMATCH: '所选岗位不属于当前组织，请重新选择岗位',
  PRIMARY_ASSIGNMENT_CONFLICT: '员工已有主任职，请使用调岗功能',
  EMPLOYEE_IDENTITY_CONFLICT: '工号已被在职员工占用，或身份证/执业证已存在，请核对后重试',
  TEAM_LEAD_CONFLICT: '团队已有负责人，请使用更换负责人功能',
  ACCOUNT_BINDING_CONFLICT: '该员工或账号已存在绑定关系',
  REPORTING_LINE_CYCLE: '汇报关系不能形成循环，请重新选择上级',
  MFA_ENROLLMENT_REQUIRED: '此操作需要先绑定身份验证器',
  STEP_UP_REQUIRED: '此操作需要完成身份验证',
};

type RequestFailure = { response?: { status?: number; data?: { message?: string; errors?: { organizationDeleteBlockers?: unknown } } } };

const organizationBlockerLabels: Record<string, string> = {
  children: '下级组织', positions: '岗位', assignments: '任职历史', professionalTeams: '专业团队',
  dataScopes: '数据范围', dataScopeTargets: '范围目标', eventLogsOrganization: '组织事件', eventLogsBranch: '分所事件',
};

export function requestErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const response = (error as RequestFailure | null)?.response;
  const code = response?.data?.message ?? (error instanceof Error ? error.message : undefined);
  if (code === 'ORGANIZATION_DELETE_IN_USE') {
    const blockers = response?.data?.errors?.organizationDeleteBlockers;
    if (blockers && typeof blockers === 'object' && !Array.isArray(blockers)) {
      const known = Object.entries(blockers).filter(([key, count]) => Object.hasOwn(organizationBlockerLabels, key) && typeof count === 'number' && Number.isSafeInteger(count) && count > 0);
      if (known.length) {
        const reasons = known.map(([key, count]) => `${organizationBlockerLabels[key]} ${count} 条`).join('、');
        const advice = known.every(([key]) => key === 'children')
          ? '请先移动或删除下级组织，再删除当前组织'
          : '有关联记录时无法直接删除；需保留历史时请按停用规则处理';
        return `无法删除：存在${reasons}。${advice}`;
      }
    }
  }
  if (code === 'VALIDATION_FAILED' && response?.status === 409) return '输入内容与现有记录冲突，请检查重复项或关联数据';
  if (code && messages[code]) return messages[code];
  if (code && (!response || (response.status && response.status < 500)) && /[\u4e00-\u9fff]/.test(code)) return code;
  if (response?.status === 401) return '登录已过期，请重新登录';
  if (response?.status === 403) return '没有权限执行此操作';
  if (response?.status === 404) return '请求的资源不存在或已不可访问';
  if (response?.status === 409) return '当前数据状态存在冲突，请刷新后检查';
  if (response?.status === 400 || response?.status === 422) return messages.VALIDATION_FAILED;
  return fallback;
}

export function showRequestError(error: unknown, fallback?: string): void {
  if (error && typeof error === 'object') {
    if (reported.has(error)) return;
    reported.add(error);
  }
  message.error(requestErrorMessage(error, fallback));
}
