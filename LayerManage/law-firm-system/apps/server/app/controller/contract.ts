// SPEC-010 Task 10: contract HTTP 控制器（整体替代 SPEC-001 原型——原型控制器随 Task 1 移除）。
// 薄控制器纪律（仿 SPEC-009 T10 lead.ts/customer.ts）：传输层解析（query 数字/键名白名单）
// → 调 Task 7-9 冻结服务 → 包络响应；状态机/政策门禁/范围/同事务事件全部在服务层。
// 合同无 update 路由（路由表无 PATCH /contracts/:id——创建后仅经动作路由流转，设计如此）；
// 显式组织锚伪造在服务层 4a 探针 400（Task 7 裁决 4），控制器透传不新增校验。
// plans 子资源走 ReceivableService.listPlans（payment.read，Task 9 冻结方法），路径挂合同下。

import { Controller } from 'egg';

import { contractService, receivableService } from '../application/contract/contract-factory';
import {
  ApproveContractInput,
  ContractListQuery,
  CreateContractInput,
  EffectContractInput,
  RejectContractInput,
  SignContractInput,
  TerminateContractInput,
  VoidContractInput,
} from '../application/contract/contract-types';
import { ContractStatus, ContractType } from '../domain/contract/contract-policy';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CREATE_BODY_KEYS = [
  'contractType', 'title', 'customerId', 'sourceType', 'sourceId', 'negotiationId',
  'parentContractId', 'templateCode', 'amount', 'paymentTerms', 'startDate', 'endDate',
  'terms', 'branchId', 'professionalTeamId',
] as const;
const APPROVE_BODY_KEYS = ['comment'] as const;
const REJECT_BODY_KEYS = ['comment'] as const;
const SIGN_BODY_KEYS = ['signDate', 'esignLinkId', 'esignSerialNo', 'esignStatus'] as const;
const EFFECT_BODY_KEYS = ['effectiveDate', 'idempotencyKey', 'conflictReview'] as const;
const TERMINATE_BODY_KEYS = ['reason'] as const;
const VOID_BODY_KEYS = ['reason'] as const;

export default class ContractController extends Controller {
  /** POST /api/v1/contracts（contract.create）：四来源创建，初始 DRAFT。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CREATE_BODY_KEYS);
    this.respond(await contractService(this.ctx).createContract(body as unknown as CreateContractInput));
  }

  /** GET /api/v1/contracts（contract.read）：范围列表 + status/contractType/customerId/keyword 过滤。 */
  async index() {
    this.respond(await contractService(this.ctx).listContracts(parseContractListQuery(this.ctx.query)));
  }

  /** GET /api/v1/contracts/:id（contract.read）：详情，不存在/越权统一 404。 */
  async show() {
    this.respond(await contractService(this.ctx).getContract(this.ctx.params.id));
  }

  /** POST /api/v1/contracts/:id/submit（contract.submit）：DRAFT→政策分流。 */
  async submit() {
    this.respond(await contractService(this.ctx).submitContract(this.ctx.params.id));
  }

  /** POST /api/v1/contracts/:id/approve（contract.approve）：PENDING_APPROVAL→PENDING_SIGN。 */
  async approve() {
    const body = this.ctx.request.body;
    assertExactKeys(body, APPROVE_BODY_KEYS);
    this.respond(await contractService(this.ctx).approveContract(
      this.ctx.params.id,
      body as unknown as ApproveContractInput,
    ));
  }

  /** POST /api/v1/contracts/:id/reject（contract.approve）：PENDING_APPROVAL→DRAFT，comment 必填。 */
  async reject() {
    const body = this.ctx.request.body;
    assertExactKeys(body, REJECT_BODY_KEYS);
    this.respond(await contractService(this.ctx).rejectContract(
      this.ctx.params.id,
      body as unknown as RejectContractInput,
    ));
  }

  /** POST /api/v1/contracts/:id/sign（contract.sign）：PENDING_SIGN→SIGNED。 */
  async sign() {
    const body = this.ctx.request.body;
    assertExactKeys(body, SIGN_BODY_KEYS);
    this.respond(await contractService(this.ctx).signContract(
      this.ctx.params.id,
      body as unknown as SignContractInput,
    ));
  }

  /** POST /api/v1/contracts/:id/effect（contract.effect）：SIGNED→EFFECTIVE + 生效事务矩阵。 */
  async screenEffectCase() { this.respond(await contractService(this.ctx).screenEffectCase(this.ctx.params.id)); }

  async effect() {
    const body = this.ctx.request.body;
    assertExactKeys(body, EFFECT_BODY_KEYS);
    this.respond(await contractService(this.ctx).effectContract(
      this.ctx.params.id,
      body as unknown as EffectContractInput,
    ));
  }

  /** POST /api/v1/contracts/:id/terminate（contract.terminate）：EFFECTIVE→TERMINATED，reason 必填。 */
  async terminate() {
    const body = this.ctx.request.body;
    assertExactKeys(body, TERMINATE_BODY_KEYS);
    this.respond(await contractService(this.ctx).terminateContract(
      this.ctx.params.id,
      body as unknown as TerminateContractInput,
    ));
  }

  /** POST /api/v1/contracts/:id/void（contract.void）：DRAFT|PENDING_APPROVAL|PENDING_SIGN→VOID，reason 必填。 */
  async void() {
    const body = this.ctx.request.body;
    assertExactKeys(body, VOID_BODY_KEYS);
    this.respond(await contractService(this.ctx).voidContract(
      this.ctx.params.id,
      body as unknown as VoidContractInput,
    ));
  }

  /** GET /api/v1/contracts/:id/plans（payment.read）：应收计划（ReceivableService.listPlans）。 */
  async plans() {
    this.respond(await receivableService(this.ctx).listPlans(this.ctx.params.id));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseContractListQuery(input: unknown): ContractListQuery {
  assertExactKeys(input, ['page', 'pageSize', 'status', 'contractType', 'customerId', 'keyword', 'caseNo', 'branchId']);
  const query: ContractListQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.status !== undefined) query.status = input.status as ContractStatus;
  if (input.contractType !== undefined) query.contractType = input.contractType as ContractType;
  if (input.customerId !== undefined) query.customerId = input.customerId as string;
  if (input.keyword !== undefined) query.keyword = input.keyword as string;
  if (input.branchId !== undefined) query.branchId = input.branchId as string;
  if (input.caseNo !== undefined) query.caseNo = input.caseNo as string;
  return query;
}

/** query 数字解析：非法形态 400（与 lead/customer 控制器同一纪律）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}
