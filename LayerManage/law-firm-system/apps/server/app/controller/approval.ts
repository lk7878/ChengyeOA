// SPEC-013 Task 6: approval HTTP 控制器（整体替代 SPEC-001 原型——原型控制器随 Task 1 移除）。
// 薄控制器纪律（逐字仿 SPEC-010 T10 payment.ts / SPEC-011 T10 invoice.ts）：传输层解析 →
// 调 Task 5 冻结服务 → 包络响应 { code:200, message:'success', data } 全同母版；业务校验/
// 权限/状态机/幂等全在服务层。index query role 必填透传（四 role：APPLIED/TODO/DONE/ALL——ALL 全组织
// 视图，approval.manage 门控，SPEC-023）；definitions 目录路由供前端
// 表单渲染（approval.apply 码）。无 delete 端点（审批实例业务不可删，仅撤回）。
// SPEC-025 Task 2: +exportDefinitions（GET /definitions/export）+ importDefinitions
// （POST /definitions/import，body {definitions}，approval.manage）——定义配置迁移。

import { Controller } from 'egg';

import {
  CreateDefinitionInput,
  UpdateDefinitionInput,
} from '../application/approval/approval-definition-service';
import {
  approvalDefinitionService,
  approvalInstanceService,
} from '../application/approval/approval-factory';
import {
  AddSignersInput,
  ApplyApprovalInput,
  ApprovalStatsQuery,
  ExportDefinitionsQuery,
  ExportInstancesQuery,
  ForwardTaskInput,
  ImportDefinitionsInput,
  ListApprovalsQuery,
  ProcessTaskInput,
  UpdateDefinitionWithStatusInput,
  WithdrawInput,
} from '../application/approval/approval-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CREATE_BODY_KEYS = ['definitionCode', 'title', 'content', 'idempotencyKey', 'attachmentIds', 'payrollBatchId', 'payrollVersion'] as const;
const PROCESS_BODY_KEYS = ['action', 'remark', 'idempotencyKey'] as const;
const FORWARD_BODY_KEYS = ['forwardToUserId', 'remark'] as const;
const ADD_SIGNERS_BODY_KEYS = ['addSignerUserIds', 'remark'] as const;
const WITHDRAW_BODY_KEYS = ['reason'] as const;
const CREATE_DEFINITION_BODY_KEYS = ['code', 'name', 'businessType', 'formSchema', 'approverRule', 'nodeSchema'] as const;
// SPEC-024：+version 可选乐观锁前置条件（客户端持已知版本，仅组合方法消费——同体 PATCH 时
// 与当前不符 → 409 APPROVAL_STATE_INVALID，确定性并发竞争语义；仅 update/仅 status 分支剥除）。
const UPDATE_DEFINITION_BODY_KEYS = ['name', 'formSchema', 'approverRule', 'nodeSchema', 'status', 'version'] as const;
// SPEC-025：导入 body definitions 数组（上限/逐定义校验在服务层）；导出为 GET。
// SPEC-029：导入 body +schemaVersion（格式版本，undefined/1 兼容）；导出 query +codes/businessType（增量）。
const IMPORT_DEFINITIONS_BODY_KEYS = ['schemaVersion', 'definitions'] as const;
const EXPORT_DEFINITIONS_QUERY_KEYS = ['codes', 'businessType'] as const;

export default class ApprovalController extends Controller {
  async createPersonalDefinition() {
    this.respond(await approvalDefinitionService(this.ctx).createPersonalDefinition(this.ctx.request.body));
  }
  /** POST /api/v1/approvals（approval.apply）：发起审批，PENDING + N task。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_BODY_KEYS);
    this.respond(await approvalInstanceService(this.ctx).applyForApproval(body as unknown as ApplyApprovalInput));
  }

  /** GET /api/v1/approvals：role 过滤 + 分页——APPLIED/TODO/DONE（approval.read）+ ALL 全组织视图（approval.manage，SPEC-023）；role 必填透传。 */
  async index() {
    this.respond(await approvalInstanceService(this.ctx).listInstances(parseApprovalListQuery(this.ctx.query)));
  }

  /** GET /api/v1/approvals/export（approval.manage，SPEC-028）：全组织实例 CSV 导出（筛选/搜索参数同 role='ALL' 语义，无 actor 过滤）。 */
  async exportInstances() {
    this.respond(await approvalInstanceService(this.ctx).exportInstances(parseExportQuery(this.ctx.query)));
  }

  /** GET /api/v1/approvals/stats（approval.manage，SPEC-030）：全组织审批统计（总量/在途/已决/类型/状态/平均决策时效，筛选同 role='ALL' 语义）。 */
  async stats() {
    this.respond(await approvalInstanceService(this.ctx).getStats(parseStatsQuery(this.ctx.query)));
  }

  /** GET /api/v1/approvals/:id（approval.read）：详情，非申请人/非审批人/缺统一 404；approval.manage 用户可见任意实例（SPEC-023）。 */
  async show() {
    this.respond(await approvalInstanceService(this.ctx).getInstance(this.ctx.params.id));
  }

  /** POST /api/v1/approvals/:id/withdraw（approval.apply）：申请人撤回 PENDING→WITHDRAWN + 待办取消。 */
  async withdraw() {
    const body = this.ctx.request.body;
    assertExactKeys(body, WITHDRAW_BODY_KEYS);
    this.respond(await approvalInstanceService(this.ctx).withdrawInstance(
      this.ctx.params.id,
      body as unknown as WithdrawInput,
    ));
  }

  /** POST /api/v1/approvals/:id/process（approval.process）：任务 APPROVE/REJECT，任一通过定稿。 */
  async process() {
    const body = this.ctx.request.body;
    assertExactKeys(body, PROCESS_BODY_KEYS);
    this.respond(await approvalInstanceService(this.ctx).processTask(
      this.ctx.params.id,
      body as unknown as ProcessTaskInput,
    ));
  }

  /** POST /api/v1/approvals/:id/forward（approval.process）：转交 PENDING 任务给其他审批人（:id=taskId）。 */
  async forward() {
    const body = this.ctx.request.body;
    assertExactKeys(body, FORWARD_BODY_KEYS);
    this.respond(await approvalInstanceService(this.ctx).forwardTask(
      this.ctx.params.id,
      body as unknown as ForwardTaskInput,
    ));
  }

  /** POST /api/v1/approvals/:id/add-signers（approval.process）：加签——向当前节点追加额外审批人（:id=taskId）。 */
  async addSigners() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ADD_SIGNERS_BODY_KEYS);
    this.respond(await approvalInstanceService(this.ctx).addSigners(
      this.ctx.params.id,
      body as unknown as AddSignersInput,
    ));
  }

  /** GET /api/v1/approvals/definitions（approval.apply）：ACTIVE 定义全量（前端发起审批页表单渲染）。 */
  async definitions() {
    this.respond(await approvalDefinitionService(this.ctx).listDefinitions());
  }

  /** POST /api/v1/approvals/definitions（approval.manage）：新建定义（code 唯一 + nodeSchema/formSchema/approverRule 三校验）。 */
  async createDefinition() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_DEFINITION_BODY_KEYS);
    this.respond(await approvalDefinitionService(this.ctx).createDefinition(body as unknown as CreateDefinitionInput));
  }

  /** GET /api/v1/approvals/definitions/manage（approval.manage）：全量定义含 DISABLED（管理页用），code 升序。 */
  async listDefinitionsManage() {
    this.respond(await approvalDefinitionService(this.ctx).listAllDefinitions());
  }

  /**
   * PATCH /api/v1/approvals/definitions/:code（approval.manage）三分支（SPEC-024）：
   * - body 同体（update 字段 + status）→ updateDefinitionWithStatus（组合方法单事务真原子，
   *   update+status 各 bump version 一次，任一段失败全回滚）；
   * - body 仅含 update 字段（name/formSchema/approverRule/nodeSchema）→ updateDefinition；
   * - body 仅含 status → setDefinitionStatus。
   * 非法 status 在服务层组合方法校验（$transaction 前，零写入即 400）；status-only 分支沿用
   * assertDefinitionStatus 预检——两条路径均保证非法值先于任何落库失败。
   */
  async updateDefinition() {
    const body = this.ctx.request.body;
    assertExactKeys(body, UPDATE_DEFINITION_BODY_KEYS);
    const service = approvalDefinitionService(this.ctx);
    const code = this.ctx.params.code;
    const status = body.status;
    const hasUpdateFields =
      body.name !== undefined || body.formSchema !== undefined
      || body.approverRule !== undefined || body.nodeSchema !== undefined;

    if (hasUpdateFields && status !== undefined) {
      // 同体（update + status）→ 组合方法单事务（原两次独立 service 调用两事务——半应用风险）。
      // 含可选 version 前置条件（客户端持已知版本）——与当前不符 → 第一段 count=0 → 409。
      this.respond(await service.updateDefinitionWithStatus(code, body as unknown as UpdateDefinitionWithStatusInput));
      return;
    }
    if (hasUpdateFields) {
      // 仅 update：剥除 version（组合方法才消费 version 前置条件；updateDefinition 无该参数，
      // 不剥会 400——version 对仅 update 分支冗余，服务端锁前读 fresh 已够）。
      const updateInput = { ...body };
      delete updateInput.version;
      this.respond(await service.updateDefinition(code, updateInput as unknown as UpdateDefinitionInput));
      return;
    }
    assertDefinitionStatus(status);
    this.respond(await service.setDefinitionStatus(code, status));
  }

  /**
   * GET /api/v1/approvals/definitions/export（approval.manage）：全量导出定义快照
   * （含 DISABLED，code 升序）——配置迁移/批量初始化的完整 JSON（SPEC-025 D2/D7）。
   * 导出为读操作，服务层不落审计（D9）。
   */
  async exportDefinitions() {
    this.respond(await approvalDefinitionService(this.ctx).exportDefinitions(parseExportDefinitionsQuery(this.ctx.query)));
  }

  /**
   * POST /api/v1/approvals/definitions/import（approval.manage）：批量导入定义
   * （body {definitions: [...]}，按 code upsert、单事务全或无、上限 100）——逐定义复用
   * create/update 校验 + version 前置条件（不符 → 409），返回 { imported, updated }（SPEC-025 D3-D7）。
   */
  async importDefinitions() {
    const body = this.ctx.request.body;
    assertExactKeys(body, IMPORT_DEFINITIONS_BODY_KEYS);
    this.respond(await approvalDefinitionService(this.ctx).importDefinitions(body as unknown as ImportDefinitionsInput));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

/** status 枚举预检（PATCH 同体组合用）：非法值在 update 落库前抛 400，保证全或无。 */
function assertDefinitionStatus(value: unknown): asserts value is 'ACTIVE' | 'DISABLED' {
  if (value !== 'ACTIVE' && value !== 'DISABLED') {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
}

function parseApprovalListQuery(input: unknown): ListApprovalsQuery {
  assertExactKeys(input, ['page', 'pageSize', 'role', 'businessType', 'status', 'applicantId', 'keyword']);
  const query: ListApprovalsQuery = { role: input.role as ListApprovalsQuery['role'] };
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  // SPEC-028：全组织视图筛选/搜索透传（字符串原样；服务层做枚举/UUID/长度校验）。
  if (input.businessType !== undefined) query.businessType = input.businessType as ListApprovalsQuery['businessType'];
  if (input.status !== undefined) query.status = input.status as ListApprovalsQuery['status'];
  if (input.applicantId !== undefined) query.applicantId = input.applicantId as string;
  if (input.keyword !== undefined) query.keyword = input.keyword as string;
  return query;
}

/** SPEC-030 统计查询解析（/approvals/stats）：筛选/搜索（同 role='ALL' 语义，服务层枚举/长度校验）。 */
function parseStatsQuery(input: unknown): ApprovalStatsQuery {
  assertExactKeys(input, ['businessType', 'status', 'applicantId', 'keyword']);
  const query: ApprovalStatsQuery = {};
  if (input.businessType !== undefined) query.businessType = input.businessType as ApprovalStatsQuery['businessType'];
  if (input.status !== undefined) query.status = input.status as ApprovalStatsQuery['status'];
  if (input.applicantId !== undefined) query.applicantId = input.applicantId as string;
  if (input.keyword !== undefined) query.keyword = input.keyword as string;
  return query;
}

/** SPEC-029 定义导出查询解析（/definitions/export）：codes（逗号分隔 ≤100）/+businessType（枚举服务层校验）。 */
function parseExportDefinitionsQuery(input: unknown): ExportDefinitionsQuery {
  assertExactKeys(input, EXPORT_DEFINITIONS_QUERY_KEYS);
  const query: ExportDefinitionsQuery = {};
  if (input.codes !== undefined) {
    if (typeof input.codes !== 'string' || input.codes.trim().length === 0) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    query.codes = input.codes.split(',').map(code => code.trim()).filter(code => code.length > 0);
  }
  if (input.businessType !== undefined) query.businessType = input.businessType as ExportDefinitionsQuery['businessType'];
  return query;
}

/** SPEC-028 导出查询解析（/approvals/export）：筛选/搜索 + maxRows（正整数，服务层校验上限）。 */
function parseExportQuery(input: unknown): ExportInstancesQuery {
  assertExactKeys(input, ['businessType', 'status', 'applicantId', 'keyword', 'maxRows']);
  const query: ExportInstancesQuery = {};
  if (input.businessType !== undefined) query.businessType = input.businessType as ExportInstancesQuery['businessType'];
  if (input.status !== undefined) query.status = input.status as ExportInstancesQuery['status'];
  if (input.applicantId !== undefined) query.applicantId = input.applicantId as string;
  if (input.keyword !== undefined) query.keyword = input.keyword as string;
  if (input.maxRows !== undefined) query.maxRows = parseQueryInteger(input.maxRows);
  return query;
}

/** query 数字解析：非法形态 400（与 payment/invoice 控制器同一纪律）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}
