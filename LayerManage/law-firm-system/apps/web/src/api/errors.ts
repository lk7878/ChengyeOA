import { message } from 'antd';

const reported = new WeakSet<object>();
const messages: Record<string, string> = {
  FINANCE_RECEIPT_HAS_REFUND: '此收款已有退款申请或执行记录，不能修改、删除或冲销，请先核对关联退费。',
  LIFECYCLE_FINANCE_LOCKED: '关联退费已进入财务审批或执行流程，不能修改申请或删除来源记录。',
  REFUND_EXECUTION_DETAILS_REQUIRED: '请先在退费业务表填写实际退费金额、退费时间并上传凭证，再执行退款。',
  REFUND_AMOUNT_EXCEEDED: '实际退费金额不能超过申请金额或合同可退的已确认收款余额。',
  EMPLOYEE_TRANSFER_REQUIRED: '该账号仍拥有文档或其他材料，请指定资源接收人后再删除',
  EMPLOYEE_ACCOUNT_NOT_BOUND: '该员工未绑定账号，无需暂停',
  EMPLOYEE_OFFBOARDING_INCOMPLETE: '请先暂停账号并登记离职完成，再删除登录账号',
  EMPLOYEE_TRANSFER_INVALID: '请选择另一名在职且账号已启用的资源接收人',
  SOP_SUBMISSION_NOT_FOUND: '成果版本不存在或无权查看',
  SOP_SELF_REVIEW: '提交人及本轮执行人不能审核自己的成果',
  SOP_REVIEW_NOT_FOUND: '审核不存在或无权查看',
  SOP_REVIEWER_INVALID: '审核人当前不可用或不在授权范围',
  SOP_REVIEW_STALE: '成果版本或流程状态已变化，请核实后重新提交',
  SOP_MATERIAL_CHANGED: '冻结材料缺失或内容已变化，不能通过审核',
  QUALITY_APPROVAL_FIXED:'请退回或撤回后再发起新的关闭审核，不支持通用转交或加签。',
  QUALITY_APPROVAL_STALE:'分析版本或审核目标已变化，不能用历史审批推进当前状态。',
  QUALITY_APPROVAL_ADAPTER_REQUIRED:'请从专项分析详情发起关闭审核。',
  QUALITY_NOT_FOUND:'记录不存在或不在当前权限范围内。',
  QUALITY_VERSION_CONFLICT:'记录已被更新，草稿已保留，请核对最新版本后重新办理。',
  QUALITY_STATE_INVALID:'当前状态不支持此操作，请刷新后核对。',
  QUALITY_SELF_REVIEW:'不能检查或复核本人参与的交付或整改。',
  QUALITY_REASON_REQUIRED:'请填写检查、补抽或取消的依据。',
  QUALITY_PRIMARY_REQUIRED:'请先创建该月份的主抽检批次。',
  QUALITY_NOT_ASSIGNEE:'仅当前获派负责人可以提交整改。',
  QUALITY_ACTOR_INACTIVE:'当前任职或账号已失效，请重新分派。',
  SOP_MATERIAL_REFERENCED: '该材料已被历史成果引用，不能删除',
  SOP_MATERIAL_NOT_FOUND: '材料不存在或无权读取',
  SOP_CLOSE_GATE_BLOCKED: '配置的SOP结案门槛尚未完成',
  SOP_CHECKLIST_INCOMPLETE: '请先完成成果版本的检查清单',
  SOP_REVIEW_REASON_REQUIRED: '退回时请填写修订依据',
  SOP_REVIEW_ROUTING_FIXED: '此审核绑定了冻结版本，请退回或撤回后重新分派',
  SOP_REVIEW_ADAPTER_REQUIRED: '请从SOP成果提交入口发起此类审核',
  SOP_TASK_ACTION_REQUIRED: '请在SOP任务详情办理此节点',
  SOP_STATE_INVALID: '任务或流程状态已变化，请刷新核对；当前输入已保留',
  SOP_DEPENDENCY_BLOCKED: '前置节点尚未完成，暂时不能执行此操作',
  SOP_REVIEW_REQUIRED: '此节点需要提交成果审核，不能直接完成',
  SOP_MATERIALS_REQUIRED: '此节点需要提交已配置的必需材料',
  SOP_TASKS_INCOMPLETE: '仍有未完成的节点，请先处理后再完成流程',
  SOP_CASE_SCOPE_MISMATCH: '模板与案件的组织、专业团队或案件类型不一致，请核对原案件归属',
  SOP_SOURCE_INVALID: '请选择一个有效的案件、线索或分析委托来源',
  SOP_SOURCE_NOT_FOUND: '来源不存在或当前无权读取，请重新选择',
  SOP_SOURCE_INACTIVE: '原业务来源已停止办理，不能推进流程',
  SOP_NODE_SELECTION_REQUIRED: '签约前流程需要明确选择本次适用节点',
  SOP_NODE_SELECTION_INVALID: '请选择模板中的节点，并包含其全部依赖节点',
  SOP_BATCH_CONFLICT: '该批次已使用不同节点启动，请打开原流程或使用新批次',
  SOP_CONTINUATION_INVALID: '前后流程缺少匹配的真实客户、合同或团队关联',
  SOP_TEMPLATE_NOT_ACTIVE: '所选模板已停用或不再是当前发布版本，请重新选择',
  SOP_ASSIGNEE_PERMISSION_REQUIRED: '该人员尚无SOP任务读取或执行权限，请先配置岗位权限',
  SOP_ASSIGNEE_NOT_AVAILABLE: '该人员已离职、停用或不在可分派范围内',
  SOP_VERSION_CONFLICT: '模板版本已变化或不可编辑；当前输入已保留，请核对最新版本后重新编辑',
  SOP_REVIEW_PENDING: '此版本正在审核，暂时不能修改或重复申请',
  SOP_DEPENDENCY_CYCLE: '前置节点形成循环，请调整节点依赖',
  SOP_DEPENDENCY_MISSING: '前置节点不存在，请重新选择',
  SOP_NODE_DUPLICATE: '节点编码不能重复',
  SOP_REVIEWER_ROLE_INVALID: '审核角色已停用或不可用，请重新配置',
  CUSTOMER_IN_USE: '客户已关联线索、案件、合同或其他业务记录，无法删除，请先核查关联记录',
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
  CASE_CONFLICT_REVIEW_REQUIRED: '案件涉及潜在利益冲突，请进入案件修改表单核验并填写排除理由。',
  CASE_HANDLING_LAWYER_UNAVAILABLE: '请选择当前组织范围内有效的承办律师。',
  CASE_CUSTOMER_UNAVAILABLE: '所选客户不存在或不在你的客户数据权限范围内，请重新选择客户或联系管理员核对客户权限；当前输入已保留',
  CASE_IN_USE: '案件已关联财务合同、成本或SOP流程记录，无法删除，请先核查关联记录',
  CASE_STATE_INVALID: '案件已结案或归档，不能修改或删除',
  CASE_NOT_FOUND: '案件不存在或已删除，请刷新列表',
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
  STEP_UP_REQUIRED: '此管理员高风险操作需要二次验证',
  ADMIN_HIGH_RISK_ONLY: '此操作仅限有权限的管理员执行，请联系管理员',
  CURRENT_PASSWORD_INVALID: '当前密码不正确',
  STEP_UP_INVALID: '验证码无效、已过期或已使用，请等待验证器生成新的六位验证码后重试',
  MFA_INVALID: '验证码无效，请检查账号并使用验证器中的当前验证码',
  MFA_REQUIRED: '管理员二次验证受保护，如需恢复请联系授权运维人员',
  MFA_RATE_LIMITED: '验证失败次数过多，请稍后重新验证',
  STEP_UP_EXPIRED: '身份验证已过期，请重新验证',
  STEP_UP_TARGET_MISMATCH: '操作目标或版本已变化，请刷新后重新操作',
};

type RequestFailure = { response?: { status?: number; data?: { message?: string; errors?: { organizationDeleteBlockers?: unknown } } } };

const organizationBlockerLabels: Record<string, string> = {
  children: '下级组织', positions: '岗位', assignments: '任职历史', professionalTeams: '专业团队',
  dataScopes: '数据范围', dataScopeTargets: '范围目标', eventLogsOrganization: '组织事件', eventLogsBranch: '分所事件',
};

export function requestErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const response = (error as RequestFailure | null)?.response;
  const code = response?.data?.message ?? (error instanceof Error ? error.message : undefined);
  if (code === 'CSRF_INVALID') return '登录校验信息已更新，请刷新页面后重试';
  if (code === 'LOGOUT_SESSION_CHANGED') return '账号已在其他标签页切换，请刷新页面确认当前账号后再退出';
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
