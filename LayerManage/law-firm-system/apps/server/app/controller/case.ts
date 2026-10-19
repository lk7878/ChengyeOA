// SPEC-033 Task 3: case HTTP 控制器（整体替代 SPEC-001 遗留原型——直连 ctx.prisma、无权限门禁、
// 无校验/审计/测试，本版本替换为薄控制器调正规 service 层）。
// 薄控制器纪律（仿 payment.ts / approval.ts）：传输层解析 → 调 case 服务 → 包络响应
// { code:200, message:'success', data }；业务校验/权限/状态机/审计全在服务层。
// SPEC-CASE-CRUD-20260914：新增带权限、版本和财务关联保护的删除。

import { Controller } from 'egg';

import {
  caseCommunicationService,
  caseFileService,
  caseService,
  caseTaskService,
} from '../application/case/case-factory';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CREATE_CASE_BODY_KEYS = ['branchId', 'intakeData', 'attachments', 'title', 'customerId', 'contractId', 'lawyerId', 'teamIds', 'caseType', 'priority', 'fee', 'description'] as const;
const UPDATE_CASE_BODY_KEYS = ['customerId', 'fee', 'intakeData', 'attachments', 'removeAttachmentIds', 'title', 'lawyerId', 'teamIds', 'caseType', 'priority', 'description', 'result', 'satisfaction', 'isReferrable', 'version'] as const;
const CLOSE_CASE_BODY_KEYS = ['result', 'satisfaction'] as const;
const CREATE_TASK_BODY_KEYS = ['name', 'nodeType', 'dueDate', 'remark'] as const;
const UPDATE_TASK_BODY_KEYS = ['status', 'remark'] as const;
const CREATE_COMMUNICATION_BODY_KEYS = ['type', 'content', 'isKey'] as const;
// SPEC-042：案件文件/证据——上传入参白名单（base64 落盘）。
const UPLOAD_FILE_BODY_KEYS = ['fileName', 'fileType', 'base64'] as const;
const FILE_LIST_QUERY_KEYS = ['page', 'pageSize'] as const;

export default class CaseController extends Controller {
  /** GET /api/v1/cases（case.read）：案件列表（过滤 + 分页）。 */
  async identityGaps() {
    assertExactKeys(this.ctx.query, ['page']);
    this.respond(await caseService(this.ctx).identityGaps({ page: this.ctx.query.page === undefined ? undefined : parseQueryInteger(this.ctx.query.page) }));
  }
  async repairIdentity() {
    this.respond(await caseService(this.ctx).repairIdentity(this.ctx.params.id, this.ctx.request.body as never));
  }

  async index() {
    this.respond(await caseService(this.ctx).listCases(parseCaseListQuery(this.ctx.query) as never));
  }

  /** GET /api/v1/cases/:id（case.read）：案件详情（含任务 + 沟通）。 */
  async show() {
    this.respond(await caseService(this.ctx).getCase(this.ctx.params.id));
  }

  /** POST /api/v1/cases（case.create）：新建案件。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_CASE_BODY_KEYS);
    this.respond(await caseService(this.ctx).createCase(body as never));
  }

  /** PUT /api/v1/cases/:id（case.update）：编辑案件。 */
  async update() {
    const body = this.ctx.request.body;
    assertExactKeys(body, UPDATE_CASE_BODY_KEYS);
    this.respond(await caseService(this.ctx).updateCase(this.ctx.params.id, body as never));
  }

  async transition() {
    this.respond(await caseService(this.ctx).transitionCase(this.ctx.params.id, this.ctx.request.body as never));
  }

  async destroy() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ['version']);
    this.respond(await caseService(this.ctx).deleteCase(this.ctx.params.id, body as never));
  }

  /** POST /api/v1/cases/:id/tasks（case.task.manage）：新建案件任务。 */
  async createTask() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_TASK_BODY_KEYS);
    this.respond(await caseTaskService(this.ctx).createTask(this.ctx.params.id, body as never));
  }

  /** PATCH /api/v1/cases/:id/tasks/:taskId（case.task.manage）：更新任务状态。 */
  async updateTask() {
    const body = this.ctx.request.body;
    assertExactKeys(body, UPDATE_TASK_BODY_KEYS);
    this.respond(await caseTaskService(this.ctx).updateTask(this.ctx.params.id, this.ctx.params.taskId, body as never));
  }

  /** POST /api/v1/cases/:id/communications（case.communication.create）：记录案件沟通。 */
  async createCommunication() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_COMMUNICATION_BODY_KEYS);
    this.respond(await caseCommunicationService(this.ctx).createCommunication(this.ctx.params.id, body as never));
  }

  /** POST /api/v1/cases/:id/close（case.close）：结案。 */
  async close() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CLOSE_CASE_BODY_KEYS);
    this.respond(await caseService(this.ctx).closeCase(this.ctx.params.id, body as never));
  }

  /** GET /api/v1/cases/:id/files（case.file.read，SPEC-042）：案件文件列表（分页）。 */
  async listFiles() {
    this.respond(await caseFileService(this.ctx).list(this.ctx.params.id, parseFileListQuery(this.ctx.query)));
  }

  /** POST /api/v1/cases/:id/files（case.file.manage，SPEC-042）：上传文件（base64 落盘）。 */
  async uploadFile() {
    const body = this.ctx.request.body;
    assertExactKeys(body, UPLOAD_FILE_BODY_KEYS);
    this.respond(await caseFileService(this.ctx).upload(this.ctx.params.id, body as never));
  }

  /** GET /api/v1/files/:id/download（case.file.read，SPEC-042）：下载文件（base64 信封）。 */
  async downloadFile() {
    this.respond(await caseFileService(this.ctx).download(this.ctx.params.id));
  }

  /** DELETE /api/v1/files/:id（case.file.manage，SPEC-042）：删除文件（删盘 + 记录）。 */
  async removeFile() {
    this.respond(await caseFileService(this.ctx).remove(this.ctx.params.id));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

/** 案件列表查询解析：page/pageSize/过滤透传（枚举/数字服务层校验）。 */
function parseCaseListQuery(input: unknown): Record<string, unknown> {
  assertExactKeys(input, ['page', 'pageSize', 'keyword', 'status', 'lawyerId', 'priority', 'customerId', 'contractId', 'caseNo', 'branchId']);
  const query: Record<string, unknown> = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.keyword !== undefined) query.keyword = input.keyword;
  if (input.branchId !== undefined) query.branchId = input.branchId as string;
  if (input.caseNo !== undefined) query.caseNo = input.caseNo;
  if (input.status !== undefined) query.status = input.status;
  if (input.lawyerId !== undefined) query.lawyerId = input.lawyerId;
  if (input.priority !== undefined) query.priority = input.priority;
  if (input.contractId !== undefined) query.contractId = input.contractId;
  if (input.customerId !== undefined) query.customerId = input.customerId;
  return query;
}

/** query 数字解析：非法形态 400。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}

/** 文件列表查询解析：page/pageSize 透传（服务层数字校验）。 */
function parseFileListQuery(input: unknown): { page?: number; pageSize?: number } {
  assertExactKeys(input, FILE_LIST_QUERY_KEYS);
  const query: { page?: number; pageSize?: number } = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  return query;
}
