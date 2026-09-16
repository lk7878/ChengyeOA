import { freezeSopReviewChecklist, guardSopApproval, lockSopApproval, sopApprovalScope, syncSopReview } from '../sop/review-policy';
// SPEC-013 Task 5: approval-instance-service —— 审批实例全生命周期（审批中心业务核心）。
// 形态逐段镜像 invoice-service：3 参构造 (prisma, actor, authorizationContext) + 可选
// outbox；requireAction 每公开方法第一行；assertExactKeys 入参白名单；同事务 EventLog +
// OperationLog；envelope objectType 'APPROVAL_INSTANCE'、branchId/teamId 恒 null（审批无
// 组织锚）、traceId actor.requestId ?? randomUUID。
// 规则（协调者裁决 + brief）：
//   applyForApproval：definition ACTIVE 探查 404 → content 按 formSchema.fields 必填字段
//     校验（缺 → VALIDATION_FAILED 400）→ resolveApproverRule（ROLE 成员经 roleMemberByCode
//     从 role/user_role 表解析：role.status ENABLED + userRole 活跃过滤 revokedAt null +
//     validFrom <= now + (validUntil null or > now)；种子 roleCodes 尚未建角色 → 该 code 无
//     行 → 空成员 → ASSIGNEE_INVALID 400 优雅兜底）→ 空集 ASSIGNEE_INVALID 400 →
//     assertNotSelfReview 409 → 单事务 Instance PENDING + N Task PENDING + approval.instance.created
//     + APPROVAL_APPLY 审计。
//   processTask：task 探查（id + assigneeId=actor）→ CallbackAction 幂等（callbackKey 限定实例域：
//     同实例命中 → 重读首结果零事件零审计；异实例已用 → CALLBACK_KEY_CONFLICT 409；并发 P2002 在
//     $transaction 外捕获重读——同实例重放/异实例 409）→ 实例行 FOR UPDATE 串行化并发决策 →
//     task {id,version,status: PENDING} 翻转（APPROVED/REJECTED）→ 任一通过定稿实例
//     （decidedBy/At、version+1）+ 余 PENDING task CANCELLED → approval.instance.completed +
//     APPROVAL_PROCESS 审计。
//   withdrawInstance：instance {id, applicantId=actor} 探查（非本人/缺 → 404）→ 非 PENDING 409
//     → 翻转 WITHDRAWN + 待办 task CANCELLED → completed(WITHDRAWN) + APPROVAL_WITHDRAW 审计。
//   listInstances/getInstance：三 role 过滤（APPLIED/TODO/DONE）+ actor 作用域 + 分页
//     （page 1/pageSize 20 上限 100/createdAt DESC id ASC）；getInstance 非申请人/审批人 404 fail-closed。
//   审计 newValues 标识符 only（instanceId/definitionCode/businessType/fromStatus/toStatus/
//     hasReason 布尔）——content/remark 自由文本不落审计。

import { syncApproved } from './approval-sync-service';
import { bindPayroll } from '../performance/payroll-service';
import { createHash, randomUUID } from 'node:crypto';
import { bindApprovalAttachments, normalizeAttachmentIds } from './approval-attachment-service';
import { fileError } from '../../domain/approval/approval-file-validation';

import { ApprovalInstance, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import { APPROVAL_ERROR_CODES, ApprovalError } from '../../domain/approval/approval-errors';
import {
  assertNotSelfReview,
  resolveApproverRule,
} from '../../domain/approval/approval-policy';
import {
  APPROVAL_BUSINESS_TYPES,
  INSTANCE_STATUSES,
  type ApprovalInstanceStatus,
  type ApproverRule,
} from '../../domain/approval/approval-types';
import {
  APPROVAL_INSTANCE_COMPLETED,
  APPROVAL_INSTANCE_CREATED,
  type ApprovalInstanceCompletedV1,
  type ApprovalInstanceCreatedV1,
  type EventEnvelopeInput,
} from '../../domain/events/event-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import {
  APPROVAL_ROLE_FILTERS,
  type AddSignersInput,
  type ApplyApprovalInput,
  type ApprovalInstanceView,
  type ApprovalStatsQuery,
  type ApprovalStatsView,
  type ExportInstancesQuery,
  type ForwardTaskInput,
  type ListApprovalsQuery,
  type PagedResult,
  type ProcessTaskInput,
  type WithdrawInput,
  projectApprovalInstance,
} from './approval-types';
import { ApprovalDefinitionService } from './approval-definition-service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type FinalStatus = 'APPROVED' | 'REJECTED';

export class ApprovalInstanceService {
  private readonly authorization: AuthorizationService;
  private readonly outbox: EventOutboxWriter;
  private readonly definitions: ApprovalDefinitionService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
    outbox?: EventOutboxWriter,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
    this.outbox = outbox ?? new PrismaEventOutboxWriter();
    this.definitions = new ApprovalDefinitionService(prisma, actor, authorizationContext);
  }

  /**
   * 发起审批：approval.apply → 定义探查（ACTIVE，404 不泄露）→ content 必填校验 → 链构建
   * （nodeSchema 空 → 顶层 approverRule 单节点，'审批'；有 → 多级节点链）→ 节点[0] 审批人
   * 解析（ROLE 成员经 roleMemberByCode 落地）→ 空集 ASSIGNEE_INVALID 400 → 自审 409 →
   * 单事务 Instance PENDING（currentNode=0）+ 节点[0] N Task PENDING（nodeName=节点[0].name）
   * + approval.instance.created（恰 5 键）+ APPROVAL_APPLY 审计（DRAFT→PENDING、currentNode:0、
   * hasReason 恒 false——apply 无 reason 入参）。
   */
  async applyForApproval(input: ApplyApprovalInput): Promise<ApprovalInstanceView> { return this.applyInternal(input); }
  async applySopReview(tx: Prisma.TransactionClient, input: ApplyApprovalInput, submissionId: string): Promise<ApprovalInstanceView> { return this.applyInternal(input,tx,submissionId); }
  private async applyInternal(input: ApplyApprovalInput, transaction?: Prisma.TransactionClient, sopSubmissionId?: string): Promise<ApprovalInstanceView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.apply');
    assertExactKeys(input, ['definitionCode', 'title', 'content', 'idempotencyKey', 'attachmentIds', 'payrollBatchId', 'payrollVersion']);
    const definitionCode = normalizeRequiredText(input.definitionCode, 1, 100);
    const title = normalizeRequiredText(input.title, 1, 200);
    // SPEC-APPR-20260911：以申请人+幂等键串行化重放，内容变化拒绝复用已提交键。
    const key = normalizeOptionalText(input.idempotencyKey, 100);
    const attachmentIds = normalizeAttachmentIds(input.attachmentIds);
    const requestKey = key ? createHash('sha256').update(this.actor.actorUserId + ':' + key).digest('hex') : null;
    const requestHash = createHash('sha256').update(JSON.stringify({ definitionCode, title, content: input.content, attachmentIds, payrollBatchId: input.payrollBatchId, payrollVersion: input.payrollVersion })).digest('hex');
    if (requestKey) {
      const existing = await (transaction ?? this.prisma).approvalInstance.findUnique({ where: { requestKey } });
      if (existing) {
        if (existing.businessType === 'SOP_REVIEW' && !sopSubmissionId) fileError('SOP_REVIEW_ADAPTER_REQUIRED', 409);
        if (existing.requestHash !== requestHash) fileError('APPROVAL_APPLY_KEY_CONFLICT', 409);
        return this.loadInstanceView(transaction ?? this.prisma, existing.id);
      }
    }

    const definition = transaction
      ? await transaction.approvalDefinition.findFirstOrThrow({where:{code:definitionCode,status:'ACTIVE',OR:[{ownerUserId:null},{ownerUserId:this.actor.actorUserId}]}})
      : await this.definitions.getActiveDefinition(definitionCode);
    if (definition.businessType === 'SOP_REVIEW') {
      if (!transaction || !sopSubmissionId) fileError('SOP_REVIEW_ADAPTER_REQUIRED',409);
      const sub = await transaction!.sopSubmission.findUniqueOrThrow({where:{id:sopSubmissionId!}});
      if (sub.submittedBy !== this.actor.actorUserId || input.content.submissionId !== sub.id || input.content.contentHash !== sub.contentHash) fileError('SOP_REVIEW_ADAPTER_REQUIRED',409);
    } else if (sopSubmissionId) fileError('SOP_REVIEW_ADAPTER_REQUIRED',409);
    this.assertContentMatchesSchema(input.content, definition.formSchema);
    if (definition.businessType === 'PAYROLL') {
      this.authorization.requireAction(this.authorizationContext, 'performance.update');
      if (!input.payrollBatchId || !Number.isSafeInteger(input.payrollVersion) || !input.payrollVersion) fileError('PAYROLL_BATCH_REQUIRED', 400);
      normalizeRequiredText(input.payrollBatchId, 1, 100);
    } else if (input.payrollBatchId || input.payrollVersion) fileError('PAYROLL_BATCH_REQUIRED', 400);
    const chain = buildApprovalChain(definition);
    const node0ApproverIds = await this.resolveApproverIds(chain[0].approverRule, this.actor.actorUserId, transaction ?? this.prisma);
    if (node0ApproverIds.length === 0) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID,
        400,
        'approval has no approvers',
      );
    }
    assertNotSelfReview(this.actor.actorUserId, node0ApproverIds);

    const write = async (tx: Prisma.TransactionClient) => {
      if (requestKey) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))::text`;
        const existing = await tx.approvalInstance.findUnique({ where: { requestKey } });
        if (existing) {
          if (existing.businessType === 'SOP_REVIEW' && !sopSubmissionId) fileError('SOP_REVIEW_ADAPTER_REQUIRED', 409);
        if (existing.requestHash !== requestHash) fileError('APPROVAL_APPLY_KEY_CONFLICT', 409);
          return this.loadInstanceView(tx, existing.id);
        }
      }
      const instance = await tx.approvalInstance.create({
        data: {
          requestKey, requestHash,
          formSnapshot: { name: definition.name, formSchema: definition.formSchema } as Prisma.InputJsonValue,
          definitionId: definition.id,
          definitionVersion: definition.version,
          businessType: definition.businessType,
          title,
          content: input.content as unknown as Prisma.InputJsonValue,
          applicantId: this.actor.actorUserId,
          status: 'PENDING',
          createdBy: this.actor.actorUserId,
        },
      });

      if (input.payrollBatchId) await bindPayroll(tx, input.payrollBatchId, input.payrollVersion!, instance.id, attachmentIds, this.actor, input.content.period);
      await bindApprovalAttachments(tx, attachmentIds, instance.id, this.actor);

      for (const approverId of node0ApproverIds) {
        await tx.approvalTask.create({
          data: {
            instanceId: instance.id,
            nodeName: chain[0].name,
            assigneeId: approverId,
            status: 'PENDING',
          },
        });
      }

      if (sopSubmissionId) await tx.qualityReview.update({where:{submissionId:sopSubmissionId},data:{approvalInstanceId:instance.id,reviewerUserId:node0ApproverIds[0],status:'PENDING',version:{increment:1}}});
      const payload: ApprovalInstanceCreatedV1 = {
        instanceId: instance.id,
        businessType: definition.businessType,
        title,
        applicantId: this.actor.actorUserId,
        status: 'PENDING',
      };
      await this.outbox.append(tx, this.envelope(instance.id, payload, APPROVAL_INSTANCE_CREATED));
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'APPROVAL_APPLY',
          targetType: 'APPROVAL_INSTANCE',
          targetId: instance.id,
          newValues: JSON.stringify({
            instanceId: instance.id,
            definitionCode: definition.code,
            businessType: definition.businessType,
            fromStatus: 'DRAFT',
            toStatus: 'PENDING',
            currentNode: 0,
            hasReason: false,
          }),
          ip: this.actor.ip,
        },
      });

      return this.loadInstanceView(tx, instance.id);
    };
    return transaction ? write(transaction) : this.prisma.$transaction(write);
  }

  /**
   * 处理审批任务：approval.process → task 探查（id + assigneeId=actor，404 不泄露）→
   * CallbackAction 幂等（callbackKey=idempotencyKey 限定实例域：同实例命中 → 重读首结果零事件零
   * 审计；异实例已用 → CALLBACK_KEY_CONFLICT 409；并发 P2002 在 $transaction 外捕获重读——同实例
   * 重放/异实例 409）→ 实例行 FOR UPDATE（同一实例并发审批决策串行化）→ task 重读：已处理 →
   * 幂等重放返回现状；CANCELLED → STATE_INVALID 409 → 翻转 task（version+1）→ 多级语义：
   *   - APPROVE 非末节点（多级推进）→ 取消当前节点余 PENDING task + 下节点审批人解析（含下节点
   *     自审 409——禁止自审适用全部节点）+ create 下节点 Task + currentNode++/version+1，实例仍
   *     PENDING，不产 completed 事件；APPROVAL_PROCESS 审计 toStatus=PENDING + currentNode。
   *   - REJECT 或末节点 APPROVE → 定稿实例（PENDING→APPROVED/REJECTED，decidedBy/At、version+1）
   *     + 当前+未来 PENDING task 全 CANCELLED → approval.instance.completed（恰 3 键）+
   *     APPROVAL_PROCESS 审计。
   */
  async processTask(taskId: string, input: ProcessTaskInput): Promise<ApprovalInstanceView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.process');
    assertExactKeys(input, ['action', 'remark', 'idempotencyKey']);
    const action = normalizeAllowedValue(input.action, ['APPROVE', 'REJECT']);
    const remark = normalizeOptionalText(input.remark, 500);
    const idempotencyKey = normalizeOptionalText(input.idempotencyKey, 100);
    const normalizedTaskId = normalizeRequiredText(taskId, 1, 100);
    const target: FinalStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    // 前置 task 探查：确认归属并解析 targetInstanceId（并发 P2002 兜底重读判定异实例 409 用）。
    const taskRow = await this.prisma.approvalTask.findFirst({
      where: { id: normalizedTaskId, assigneeId: this.actor.actorUserId },
    });
    if (!taskRow) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND,
        404,
        'approval task not found',
      );
    }
    const targetInstanceId = taskRow.instanceId;
    await guardSopApproval(this.prisma,this.authorizationContext,targetInstanceId,action,remark);

    try {
      return await this.prisma.$transaction(async tx => {
        const task = await tx.approvalTask.findFirst({
          where: { id: normalizedTaskId, assigneeId: this.actor.actorUserId },
        });
        if (!task) {
          throw new ApprovalError(
            APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND,
            404,
            'approval task not found',
          );
        }

        if (idempotencyKey) {
          // 幂等查找限定实例域：同实例命中 → 重放首结果；异实例已用 → CALLBACK_KEY_CONFLICT 409。
          const sameInstance = await tx.callbackAction.findFirst({
            where: { callbackKey: idempotencyKey, instanceId: task.instanceId },
          });
          if (sameInstance) {
            return this.loadInstanceView(tx, sameInstance.instanceId);
          }
          const crossInstance = await tx.callbackAction.findFirst({
            where: { callbackKey: idempotencyKey, instanceId: { not: task.instanceId } },
          });
          if (crossInstance) {
            throw new ApprovalError(
              APPROVAL_ERROR_CODES.CALLBACK_KEY_CONFLICT,
              409,
              'idempotency key already used for another approval',
            );
          }
        }

        // 锁实例行：同一实例的并发审批决策整体串行（互斥依据——写事务首把锁恒实例行）。
        await lockSopApproval(tx,task.instanceId);
        await tx.$queryRaw`SELECT id FROM approval_instance WHERE id = ${task.instanceId} FOR UPDATE`;
        await guardSopApproval(tx,this.authorizationContext,task.instanceId,action,remark);

        const fresh = await tx.approvalTask.findUniqueOrThrow({ where: { id: task.id } });
        if (fresh.status === 'APPROVED' || fresh.status === 'REJECTED') {
          // 幂等重放：同任务重复处理（无 key 重试或并发败者）→ 返回现状零事件零审计。
          return this.loadInstanceView(tx, task.instanceId);
        }
        if (fresh.status !== 'PENDING') {
          throw new ApprovalError(
            APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
            409,
            `cannot process approval task in status ${fresh.status}`,
          );
        }

        const instance = await tx.approvalInstance.findUniqueOrThrow({
          where: { id: task.instanceId },
        });
        if (instance.status !== 'PENDING') {
          throw new ApprovalError(
            APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
            409,
            `cannot process task of instance in status ${instance.status}`,
          );
        }

        const definition = await tx.approvalDefinition.findUniqueOrThrow({
          where: { id: instance.definitionId },
        });
        const chain = buildApprovalChain(definition);
        const currentNode = instance.currentNode;
        const isFinalNode = currentNode >= chain.length - 1;

        const now = new Date();
        const flipped = await tx.approvalTask.updateMany({
          where: { id: fresh.id, version: fresh.version, status: 'PENDING' },
          data: {
            status: target,
            remark,
            processedBy: this.actor.actorUserId,
            processedAt: now,
            version: { increment: 1 },
          },
        });
        if (flipped.count === 0) {
          throw new ApprovalError(
            APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
            409,
            'approval task state changed concurrently',
          );
        }

        // SPEC-018 会签 + 多级推进：APPROVE 时先判当前节点 mode==='ALL'——该节点仍有 PENDING
        // task（非最后一签）→ 停留当前节点（仅翻转已做，实例 currentNode/version 不变、零推进、
        // 零 completed、不建下节点 Task）；最后一签（remainingPending===0）→ 落既有推进/定稿分支。
        // 缺省/'ANY' 节点短路（node.mode === 'ALL' 为 false，既有 ANY 语义零回归）。
        if (target === 'APPROVED') {
          const node = chain[currentNode];
          if (node.mode === 'ALL') {
            const remainingPending = await tx.approvalTask.count({
              where: { instanceId: instance.id, nodeName: node.name, status: 'PENDING' },
            });
            if (remainingPending > 0) {
              // 会签未满：仅翻转当前 task。审计 toStatus PENDING + mode ALL；callback result
              // {status PENDING, currentNode}；实例 currentNode/version 不变、零 completed 事件。
              if (idempotencyKey) {
                await tx.callbackAction.create({
                  data: {
                    instanceId: instance.id,
                    action,
                    callbackKey: idempotencyKey,
                    status: 'RESPONDED',
                    result: {
                      instanceId: instance.id,
                      action,
                      status: 'PENDING',
                      currentNode: instance.currentNode,
                    } as unknown as Prisma.InputJsonValue,
                  },
                });
              }
              await tx.operationLog.create({
                data: {
                  userId: this.actor.actorUserId,
                  action: 'APPROVAL_PROCESS',
                  targetType: 'APPROVAL_INSTANCE',
                  targetId: instance.id,
                  newValues: JSON.stringify({
                    instanceId: instance.id,
                    definitionCode: definition.code,
                    businessType: definition.businessType,
                    fromStatus: 'PENDING',
                    toStatus: 'PENDING',
                    currentNode: instance.currentNode,
                    mode: 'ALL',
                    hasReason: remark !== null,
                  }),
                  ip: this.actor.ip,
                },
              });
              return this.loadInstanceView(tx, instance.id);
            }
          }
          if (!isFinalNode) {
            const nextNode = chain[currentNode + 1];
            const nextApproverIds = await this.resolveApproverIds(nextNode.approverRule, instance.applicantId, tx);
            if (nextApproverIds.length === 0) {
              throw new ApprovalError(
                APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID,
                400,
                'approval has no approvers',
              );
            }
            // 禁止自审适用全部节点：下节点审批人含申请人 → 409（事务回滚，当前 task 翻转撤销）。
            assertNotSelfReview(instance.applicantId, nextApproverIds);

            await tx.approvalTask.updateMany({
              where: { instanceId: instance.id, status: 'PENDING' },
              data: { status: 'CANCELLED', version: { increment: 1 } },
            });
            for (const approverId of nextApproverIds) {
              await tx.approvalTask.create({
                data: {
                  instanceId: instance.id,
                  nodeName: nextNode.name,
                  assigneeId: approverId,
                  status: 'PENDING',
                },
              });
            }
            await tx.approvalInstance.updateMany({
              where: { id: instance.id, status: 'PENDING' },
              data: { currentNode: { increment: 1 }, version: { increment: 1 } },
            });

            if (idempotencyKey) {
              await tx.callbackAction.create({
                data: {
                  instanceId: instance.id,
                  action,
                  callbackKey: idempotencyKey,
                  status: 'RESPONDED',
                  result: {
                    instanceId: instance.id,
                    action,
                    status: 'PENDING',
                    currentNode: currentNode + 1,
                  } as unknown as Prisma.InputJsonValue,
                },
              });
            }

            await tx.operationLog.create({
              data: {
                userId: this.actor.actorUserId,
                action: 'APPROVAL_PROCESS',
                targetType: 'APPROVAL_INSTANCE',
                targetId: instance.id,
                newValues: JSON.stringify({
                  instanceId: instance.id,
                  definitionCode: definition.code,
                  businessType: definition.businessType,
                  fromStatus: 'PENDING',
                  toStatus: 'PENDING',
                  currentNode: currentNode + 1,
                  hasReason: remark !== null,
                }),
                ip: this.actor.ip,
              },
            });

            return this.loadInstanceView(tx, instance.id);
          }
        }

        // 定稿：REJECT（任意节点）或末节点 APPROVE → 实例终态（decidedBy/At、version+1）+
        // 当前+未来 PENDING task 全 CANCELLED + approval.instance.completed + PROCESS 审计。
        await tx.approvalInstance.updateMany({
          where: { id: instance.id, status: 'PENDING' },
          data: {
            status: target,
            decidedBy: this.actor.actorUserId,
            decidedAt: now,
            version: { increment: 1 },
          },
        });

        await tx.approvalTask.updateMany({
          where: { instanceId: instance.id, status: 'PENDING' },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });

        if (idempotencyKey) {
          await tx.callbackAction.create({
            data: {
              instanceId: instance.id,
              action,
              callbackKey: idempotencyKey,
              status: 'RESPONDED',
              result: {
                instanceId: instance.id,
                action,
                status: target,
                decidedBy: this.actor.actorUserId,
              } as unknown as Prisma.InputJsonValue,
            },
          });
        }

        const payload: ApprovalInstanceCompletedV1 = {
          instanceId: instance.id,
          businessType: definition.businessType,
          status: target,
        };
        if (target === 'APPROVED' && instance.businessType === 'SOP_REVIEW') await freezeSopReviewChecklist(tx,instance.id);
        if (target === 'APPROVED') await syncApproved(tx, instance.id, this.actor, this.authorizationContext);
        else await syncSopReview(tx,instance.id,this.actor);
        await this.outbox.append(tx, this.envelope(instance.id, payload, APPROVAL_INSTANCE_COMPLETED));
        await tx.operationLog.create({
          data: {
            userId: this.actor.actorUserId,
            action: 'APPROVAL_PROCESS',
            targetType: 'APPROVAL_INSTANCE',
            targetId: instance.id,
            newValues: JSON.stringify({
              instanceId: instance.id,
              definitionCode: definition.code,
              businessType: definition.businessType,
              fromStatus: 'PENDING',
              toStatus: target,
              hasReason: remark !== null,
            }),
            ip: this.actor.ip,
          },
        });

        return this.loadInstanceView(tx, instance.id);
      });
    } catch (error) {
      // PostgreSQL P2002 会中止当前事务：须在 $transaction 调用外捕获。callbackKey 唯一冲突 →
      // 新查询重读归属：同实例 → 幂等重放；异实例 → CALLBACK_KEY_CONFLICT 409（不泄露异实例 id）。
      if (!isUniqueConflictOn(error, 'callbackKey') || !idempotencyKey) {
        throw error;
      }
      const winner = await this.prisma.callbackAction.findUnique({
        where: { callbackKey: idempotencyKey },
      });
      if (!winner) throw error;
      if (winner.instanceId === targetInstanceId) {
        return this.loadInstanceView(this.prisma, winner.instanceId);
      }
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.CALLBACK_KEY_CONFLICT,
        409,
        'idempotency key already used for another approval',
      );
    }
  }

  /**
   * 转交审批任务（SPEC-019）：approval.process → 入参白名单 → forwardToUserId 必填（1-100）
   * → task 探查（id + assigneeId=actor，非我 404）→ 非 PENDING 409 → 转交给自己 400 →
   * 转交目标 = instance.applicantId → 409 APPROVAL_SELF_REVIEW_FORBIDDEN（沿 domain 禁止自审
   * 不变量——申请人成为 PENDING task assignee 即自审绕过）→ 事务内
   * updateMany({id, version, status:'PENDING'}, {assigneeId, version+1})
   * （count 0 → 409 并发竞争）+ APPROVAL_TASK_FORWARD 审计（targetType APPROVAL_TASK，
   * newValues 含 taskId/fromUserId/toUserId/hasReason，remark 自由文本不落）→ 返回 loadInstanceView。
   * 零事件（D7）、不建 callbackAction（D8）；task.status/nodeName/实例 currentNode/status/version
   * 全不变——纯 assigneeId 变更（D4/D5）。
   */
  async forwardTask(taskId: string, input: ForwardTaskInput): Promise<ApprovalInstanceView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.process');
    assertExactKeys(input, ['forwardToUserId', 'remark']);
    const forwardToUserId = normalizeRequiredText(input.forwardToUserId, 1, 100);
    const remark = normalizeOptionalText(input.remark, 500);
    const normalizedTaskId = normalizeRequiredText(taskId, 1, 100);

    // 前置探查：确认归属并取 instance.applicantId（评审修复——禁止转交给申请人）。
    const task = await this.prisma.approvalTask.findFirst({
      where: { id: normalizedTaskId, assigneeId: this.actor.actorUserId },
      include: { instance: { select: { applicantId: true } } },
    });
    if (!task) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND,
        404,
        'approval task not found',
      );
    }
    if (task.status !== 'PENDING') {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
        409,
        `cannot forward approval task in status ${task.status}`,
      );
    }
    if (forwardToUserId === this.actor.actorUserId) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID,
        400,
        'cannot forward an approval task to yourself',
      );
    }
    // 评审 Important 修复：转交目标 = 申请人 → 自审绕过 → 409（沿 apply 首节点/process 下节点同款不变量）。
    assertNotSelfReview(task.instance.applicantId, [forwardToUserId]);

    await guardSopApproval(this.prisma,this.authorizationContext,task.instanceId,'FORWARD');
    return this.prisma.$transaction(async tx => {
      const flipped = await tx.approvalTask.updateMany({
        where: { id: task.id, version: task.version, status: 'PENDING' },
        data: { assigneeId: forwardToUserId, version: { increment: 1 } },
      });
      if (flipped.count === 0) {
        throw new ApprovalError(
          APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
          409,
          'approval task state changed concurrently',
        );
      }

      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'APPROVAL_TASK_FORWARD',
          targetType: 'APPROVAL_TASK',
          targetId: task.id,
          newValues: JSON.stringify({
            taskId: task.id,
            fromUserId: this.actor.actorUserId,
            toUserId: forwardToUserId,
            hasReason: remark !== null,
          }),
          ip: this.actor.ip,
        },
      });

      return this.loadInstanceView(tx, task.instanceId);
    });
  }

  /**
   * 审批加签（SPEC-020）：approval.process → 入参白名单 → addSignerUserIds 必填非空数组
   * （1-10 人，每人 1-100，去重）→ task 探查（id + assigneeId=actor，非我 404）→ task 非
   * PENDING 409 → 实例非 PENDING 409 → 校验目标：含自己 400（加签给自己无意义）、含申请人
   * 409（自审不变量）→ 事务内实例行 FOR UPDATE（沿 processTask 锁点）→ 锁后重验 task 仍
   * PENDING 且 nodeName===chain[currentNode].name（仍当前节点，防加签与推进竞速孤儿 task）
   * → 创建 N 个同节点 PENDING task（nodeName=task.nodeName，assigneeId=目标）→
   * APPROVAL_TASK_ADD_SIGNER 审计（targetType APPROVAL_TASK，newValues 含
   * taskId/addedUserIds/hasReason，remark 自由文本不落）。实例 currentNode/status/version
   * 不变；零 outbox 事件；不建 callbackAction（D4/D7/D8）。
   */
  async addSigners(taskId: string, input: AddSignersInput): Promise<ApprovalInstanceView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.process');
    assertExactKeys(input, ['addSignerUserIds', 'remark']);
    const addSignerUserIds = normalizeAddSignerUserIds(input.addSignerUserIds);
    const remark = normalizeOptionalText(input.remark, 500);
    const normalizedTaskId = normalizeRequiredText(taskId, 1, 100);

    // 前置 task 探查：确认归属（沿 processTask/forwardTask 非我 404 语义）。
    const task = await this.prisma.approvalTask.findFirst({
      where: { id: normalizedTaskId, assigneeId: this.actor.actorUserId },
    });
    if (!task) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_TASK_NOT_FOUND,
        404,
        'approval task not found',
      );
    }
    if (task.status !== 'PENDING') {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
        409,
        `cannot add signers to approval task in status ${task.status}`,
      );
    }
    const instance = await this.prisma.approvalInstance.findUniqueOrThrow({
      where: { id: task.instanceId },
    });
    if (instance.status !== 'PENDING') {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
        409,
        `cannot add signers to instance in status ${instance.status}`,
      );
    }
    // 校验目标：含自己 400（加签给自己无意义）、含申请人 409（禁止自审不变量，沿 forward 同款守卫）。
    for (const userId of addSignerUserIds) {
      if (userId === this.actor.actorUserId) {
        throw new ApprovalError(
          APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID,
          400,
          'cannot add yourself as an additional signer',
        );
      }
      if (userId === instance.applicantId) {
        throw new ApprovalError(
          APPROVAL_ERROR_CODES.APPROVAL_SELF_REVIEW_FORBIDDEN,
          409,
          'cannot add the applicant as an additional signer',
        );
      }
    }

    await guardSopApproval(this.prisma,this.authorizationContext,task.instanceId,'FORWARD');
    return this.prisma.$transaction(async tx => {
      // D4.1 首把锁 = 实例行 FOR UPDATE：与 processTask/推进互斥（沿 processTask 锁点），
      // 防加签与推进竞速产生孤儿 PENDING task（推进先锁则 currentNode 已变）。
      await tx.$queryRaw`SELECT id FROM approval_instance WHERE id = ${task.instanceId} FOR UPDATE`;

      // 锁后重验：task 仍 PENDING 且仍当前节点（nodeName===chain[currentNode].name）——否则
      // 409 APPROVAL_STATE_INVALID（D4.1 实证：推进先提交 → 加签 409 或创建后被取消，均无孤儿）。
      const freshTask = await tx.approvalTask.findFirst({
        where: { id: normalizedTaskId, assigneeId: this.actor.actorUserId },
      });
      if (!freshTask || freshTask.status !== 'PENDING') {
        throw new ApprovalError(
          APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
          409,
          'approval task state changed concurrently',
        );
      }
      const freshInstance = await tx.approvalInstance.findUniqueOrThrow({
        where: { id: task.instanceId },
      });
      const definition = await tx.approvalDefinition.findUniqueOrThrow({
        where: { id: freshInstance.definitionId },
      });
      const chain = buildApprovalChain(definition);
      if (freshTask.nodeName !== chain[freshInstance.currentNode].name) {
        throw new ApprovalError(
          APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
          409,
          'approval task no longer belongs to the current node',
        );
      }

      // 创建 N 个同节点 PENDING task（nodeName=task.nodeName，assigneeId=目标）。
      for (const userId of addSignerUserIds) {
        await tx.approvalTask.create({
          data: {
            instanceId: task.instanceId,
            nodeName: freshTask.nodeName,
            assigneeId: userId,
            status: 'PENDING',
          },
        });
      }

      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'APPROVAL_TASK_ADD_SIGNER',
          targetType: 'APPROVAL_TASK',
          targetId: task.id,
          newValues: JSON.stringify({
            taskId: task.id,
            addedUserIds: addSignerUserIds,
            hasReason: remark !== null,
          }),
          ip: this.actor.ip,
        },
      });

      return this.loadInstanceView(tx, task.instanceId);
    });
  }

  /**
   * 撤回申请：approval.apply → instance {id, applicantId=actor} 探查（非本人/缺统一 404）→
   * 非 PENDING 409 → 翻转 WITHDRAWN + 待办 task CANCELLED → completed(WITHDRAWN) +
   * APPROVAL_WITHDRAW 审计。翻转败者重读：已 WITHDRAWN → 幂等重放返回现状，其他 → 409。
   */
  async withdrawInstance(id: string, input: WithdrawInput): Promise<ApprovalInstanceView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.apply');
    assertExactKeys(input, ['reason']);
    const reason = normalizeOptionalText(input.reason, 500);
    const instanceId = normalizeRequiredText(id, 1, 100);

    const instance = await this.prisma.approvalInstance.findFirst({
      where: { id: instanceId, applicantId: this.actor.actorUserId },
    });
    if (!instance) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_INSTANCE_NOT_FOUND,
        404,
        'approval instance not found',
      );
    }
    if (instance.status !== 'PENDING') {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
        409,
        `cannot withdraw instance in status ${instance.status}`,
      );
    }

    return this.prisma.$transaction(async tx => {
      await lockSopApproval(tx,instance.id);
      await tx.$queryRaw`SELECT id FROM approval_instance WHERE id=${instance.id} FOR UPDATE`;
      await guardSopApproval(tx,this.authorizationContext,instance.id,'WITHDRAW');
      const flipped = await tx.approvalInstance.updateMany({
        where: { id: instance.id, version: instance.version, status: 'PENDING' },
        data: { status: 'WITHDRAWN', version: { increment: 1 } },
      });
      if (flipped.count === 0) {
        const current = await tx.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } });
        if (current.status === 'WITHDRAWN') {
          await syncSopReview(tx,instance.id,this.actor);
      return this.loadInstanceView(tx, instance.id);
        }
        throw new ApprovalError(
          APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
          409,
          `cannot withdraw instance in status ${current.status}`,
        );
      }

      await tx.approvalTask.updateMany({
        where: { instanceId: instance.id, status: 'PENDING' },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });

      const definition = await tx.approvalDefinition.findUniqueOrThrow({
        where: { id: instance.definitionId },
      });
      const payload: ApprovalInstanceCompletedV1 = {
        instanceId: instance.id,
        businessType: definition.businessType,
        status: 'WITHDRAWN',
      };
      await this.outbox.append(tx, this.envelope(instance.id, payload, APPROVAL_INSTANCE_COMPLETED));
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'APPROVAL_WITHDRAW',
          targetType: 'APPROVAL_INSTANCE',
          targetId: instance.id,
          newValues: JSON.stringify({
            instanceId: instance.id,
            definitionCode: definition.code,
            businessType: definition.businessType,
            fromStatus: 'PENDING',
            toStatus: 'WITHDRAWN',
            hasReason: reason !== null,
          }),
          ip: this.actor.ip,
        },
      });

      await syncSopReview(tx,instance.id,this.actor);
      return this.loadInstanceView(tx, instance.id);
    });
  }

  /**
   * 审批列表：动态门控（D3）——role='ALL' → approval.manage（全组织视图，无 actor 过滤仅分页
   * createdAt DESC）；余三 role（APPLIED/TODO/DONE）→ approval.read + actor 作用域过滤
   * （APPLIED=applicantId=actor；TODO=task.assigneeId=actor AND status PENDING；DONE=
   * task.assigneeId=actor AND status != PENDING）→ 分页（page 1/pageSize 20 上限 100/
   * createdAt DESC id ASC）。视图含 tasks（TODO/DONE 需按 task 态）。
   */
  async listInstances(query: ListApprovalsQuery): Promise<PagedResult<ApprovalInstanceView>> {
    const role = normalizeAllowedValue(query.role, APPROVAL_ROLE_FILTERS);
    if (role === 'ALL') {
      this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    } else {
      this.authorization.requireAction(this.authorizationContext, 'approval.read');
    }
    assertExactKeys(query, ['page', 'pageSize', 'role', 'businessType', 'status', 'applicantId', 'keyword']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);

    // SPEC-028：全组织视图筛选/搜索——仅 role='ALL' 生效（其余 role 传筛选参数 → 400 防语义混用）。
    const hasFilter = query.businessType !== undefined || query.status !== undefined
      || query.applicantId !== undefined || query.keyword !== undefined;
    if (role !== 'ALL' && hasFilter) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    const where: Prisma.ApprovalInstanceWhereInput = { AND: [await sopApprovalScope(this.prisma,this.authorizationContext)] };
    if (role === 'ALL' && hasFilter) {
      buildAllViewWhere(where, query);
    }
    if (role === 'APPLIED') {
      where.applicantId = this.actor.actorUserId;
    } else if (role === 'TODO') {
      where.tasks = { some: { assigneeId: this.actor.actorUserId, status: 'PENDING' } };
    } else if (role === 'DONE') {
      where.tasks = { some: { assigneeId: this.actor.actorUserId, status: { not: 'PENDING' } } };
    } // role==='ALL' → where 空（全组织，仅分页 createdAt desc）+ 可选筛选

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.approvalInstance.count({ where }),
      this.prisma.approvalInstance.findMany({
        where,
        include: {
          tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          definition: { select: { nodeSchema: true } },
          syncRecord: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map(row => projectApprovalInstance(row)),
      page,
      pageSize,
      total,
    };
  }

  /**
   * 全组织实例 CSV 导出（SPEC-028）：approval.manage → 筛选/搜索参数（同 role='ALL' 语义，无 actor
   * 过滤）→ createdAt DESC id ASC → maxRows 截断（默认 5000/上限 10000 → 400）→ RFC 4180 CSV
   * （UTF-8 BOM + CRLF；字段含逗号/引号/换行 → 双引号包裹 + 内部引号翻倍）。
   * 读操作不落审计（沿 exportDefinitions D9 先例）。
   */
  async exportInstances(query: ExportInstancesQuery): Promise<string> {
    this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    assertExactKeys(query, ['businessType', 'status', 'applicantId', 'keyword', 'maxRows']);
    const maxRows = query.maxRows === undefined ? 5000 : normalizeExportMaxRows(query.maxRows);
    const where: Prisma.ApprovalInstanceWhereInput = { AND: [await sopApprovalScope(this.prisma,this.authorizationContext)] };
    buildAllViewWhere(where, query);
    const rows = await this.prisma.approvalInstance.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: maxRows,
    });
    return toApprovalCsv(rows);
  }

  /**
   * 全组织审批统计（SPEC-030）：approval.manage → 筛选/搜索参数（同 role='ALL' 语义，无 actor 过滤）
   * → 聚合：total（全量）/ pendingCount（PENDING）/ decidedCount（终态 Σ）/ byBusinessType / byStatus /
   * avgDecisionHours（已决实例 decidedAt-createdAt 均值小时，无已决 → null）。只读不落审计。
   */
  async getStats(query: ApprovalStatsQuery): Promise<ApprovalStatsView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    assertExactKeys(query, ['businessType', 'status', 'applicantId', 'keyword']);
    const where: Prisma.ApprovalInstanceWhereInput = { AND: [await sopApprovalScope(this.prisma,this.authorizationContext)] };
    buildAllViewWhere(where, query);

    const [total, pendingCount, decidedCount, byBusinessType, byStatus] = await Promise.all([
      this.prisma.approvalInstance.count({ where }),
      this.prisma.approvalInstance.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.approvalInstance.count({
        where: { ...where, status: { in: ['APPROVED', 'REJECTED', 'WITHDRAWN'] } },
      }),
      this.prisma.approvalInstance.groupBy({ by: ['businessType'], where, _count: { _all: true } }),
      this.prisma.approvalInstance.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);

    // 平均决策时效：JS 计算（已决实例 decidedAt-createdAt 小时均值）——避免跨 Prisma where 转 SQL。
    const decided = await this.prisma.approvalInstance.findMany({
      where: { ...where, decidedAt: { not: null } },
      select: { decidedAt: true, createdAt: true },
    });
    const avgDecisionHours = decided.length === 0
      ? null
      : Number(
        (decided.reduce(
          (sum, row) => sum + ((row.decidedAt as Date).getTime() - row.createdAt.getTime()) / 3600000,
          0,
        ) / decided.length).toFixed(1),
      );

    return {
      total,
      pendingCount,
      decidedCount,
      byBusinessType: byBusinessType.map(row => ({
        businessType: row.businessType as ApprovalStatsView['byBusinessType'][number]['businessType'],
        count: row._count._all,
      })),
      byStatus: byStatus.map(row => ({
        status: row.status as ApprovalInstanceStatus,
        count: row._count._all,
      })),
      avgDecisionHours,
    };
  }

  /**
   * 审批详情：approval.read → 申请人或任一 task 审批人可见；approval.manage 用户可见任意实例
   * （全组织视图 D6）；非申请人/非审批人且无 manage/缺统一 APPROVAL_INSTANCE_NOT_FOUND 404
   * fail-closed 不泄露存在性。
   */
  async getInstance(id: string): Promise<ApprovalInstanceView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.read');
    const instanceId = normalizeRequiredText(id, 1, 100);
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { id: instanceId },
      include: {
        tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        definition: { select: { nodeSchema: true } },
          syncRecord: true,
      },
    });
    if (!instance) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_INSTANCE_NOT_FOUND,
        404,
        'approval instance not found',
      );
    }
    const isApplicant = instance.applicantId === this.actor.actorUserId;
    const isAssignee = instance.tasks.some(task => task.assigneeId === this.actor.actorUserId);
    if (!isApplicant && !isAssignee && !this.hasManagePermission()) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_INSTANCE_NOT_FOUND,
        404,
        'approval instance not found',
      );
    }
    await guardSopApproval(this.prisma,this.authorizationContext,instance.id,'READ');
    return projectApprovalInstance(instance);
  }

  /** 授权探测：approval.manage 是否授予（AuthorizationService 无 hasAction，沿 try/catch requireAction 形态）。 */
  private hasManagePermission(): boolean {
    try {
      this.authorization.requireAction(this.authorizationContext, 'approval.manage');
      return true;
    } catch {
      return false;
    }
  }

  /** content 按 formSchema.fields 必填字段校验：非纯对象或缺必填 → VALIDATION_FAILED 400。 */
  private assertContentMatchesSchema(content: unknown, formSchema: Prisma.JsonValue): void {
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    const record = content as Record<string, unknown>;
    const schema = formSchema as { fields?: Array<{ key?: string; required?: boolean }> };
    const fields = Array.isArray(schema?.fields) ? schema.fields : [];
    for (const field of fields) {
      if (field.required && !isPresent(record[field.key ?? ''])) {
        throw new MasterDataError('VALIDATION_FAILED', 400);
      }
    }
  }

  /**
   * 审批人解析：USER 原序复制；ROLE 经 roleMemberByCode 解析（role.status ENABLED + userRole
   * 活跃过滤）；SUPERVISOR 按申请人报告线解析直属上级（applicantId → employee → 报告线步行
   * levels 级 → 上级绑定账号，任一步缺失 → ASSIGNEE_INVALID 400）。ruleJson 畸形（type 未知/
   * 缺数组）→ ASSIGNEE_INVALID 400。db 参数供事务内推进下节点时复用同一事务客户端读取
   * （apply 默认 this.prisma）。
   */
  private async resolveApproverIds(
    ruleJson: Prisma.JsonValue,
    applicantId: string,
    db: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<string[]> {
    if (!ruleJson || typeof ruleJson !== 'object' || Array.isArray(ruleJson)) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
    }
    const rule = ruleJson as { type?: string; userIds?: string[]; roleCodes?: string[]; levels?: unknown };
    if (rule.type === 'USER') {
      if (!Array.isArray(rule.userIds)) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
      }
      return resolveApproverRule(rule as ApproverRule, {});
    }
    if (rule.type === 'ROLE') {
      if (!Array.isArray(rule.roleCodes)) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
      }
      const memberByCode = await this.resolveRoleMembers(rule.roleCodes, db);
      return resolveApproverRule(rule as ApproverRule, memberByCode);
    }
    if (rule.type === 'SUPERVISOR') {
      const levels = rule.levels === undefined ? 1 : rule.levels;
      if (typeof levels !== 'number' || !Number.isInteger(levels) || levels < 1) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
      }
      return this.resolveSupervisorApprovers(applicantId, levels, db);
    }
    throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
  }

  /**
   * SUPERVISOR 解析：applicant userId → User.employeeId（无 → 400）→ 报告线步行 levels 级
   * （employee_reporting_line where employeeId=当前 + endedAt null → managerEmployeeId；任一级无
   * → 400）→ 上级 employee 绑定账号（User.employeeId=上级 employee；无 → 400）→ approverIds。
   */
  private async resolveSupervisorApprovers(
    applicantId: string,
    levels: number,
    db: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<string[]> {
    const applicantUser = await db.user.findUnique({ where: { id: applicantId } });
    if (!applicantUser?.employeeId) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'applicant has no employee binding');
    }
    let currentEmployeeId = applicantUser.employeeId;
    for (let level = 0; level < levels; level += 1) {
      const line = await db.employeeReportingLine.findFirst({
        where: { employeeId: currentEmployeeId, endedAt: null },
        select: { managerEmployeeId: true },
      });
      if (!line) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'applicant has no supervisor at required level');
      }
      currentEmployeeId = line.managerEmployeeId;
    }
    const managerUser = await db.user.findFirst({ where: { employeeId: currentEmployeeId } });
    if (!managerUser) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'supervisor has no user binding');
    }
    return [managerUser.id];
  }

  /**
   * 角色→成员解析：role.findMany {code in roleCodes, status ENABLED} + userRoles 活跃过滤
   * （revokedAt null + validFrom <= now + (validUntil null or > now)）→ Record<code, string[]>。
   * 种子 roleCodes 尚未建角色 → 该 code 无行 → 空成员集（resolveApproverRule 空集 → 400 兜底）。
   */
  private async resolveRoleMembers(
    roleCodes: string[],
    db: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<Record<string, string[]>> {
    const now = new Date();
    const roles = await db.role.findMany({
      where: { code: { in: roleCodes }, status: 'ENABLED' },
      include: {
        userRoles: {
          where: {
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
        },
      },
    });
    const memberByCode: Record<string, string[]> = {};
    for (const code of roleCodes) memberByCode[code] = [];
    for (const role of roles) {
      memberByCode[role.code] = role.userRoles.map(userRole => userRole.userId);
    }
    return memberByCode;
  }

  /** 事务内重读实例投影（含 tasks）：幂等重放与定稿返回共用。 */
  private async loadInstanceView(
    tx: Prisma.TransactionClient,
    instanceId: string,
  ): Promise<ApprovalInstanceView> {
    const instance = await tx.approvalInstance.findUniqueOrThrow({
      where: { id: instanceId },
      include: {
        tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        definition: { select: { nodeSchema: true } },
          syncRecord: true,
      },
    });
    await guardSopApproval(tx,this.authorizationContext,instance.id,'READ');
    return projectApprovalInstance(instance);
  }

  /** 事件信封：objectType 'APPROVAL_INSTANCE'、branchId/teamId 恒 null（审批无组织锚）。 */
  private envelope(
    objectId: string,
    payload: ApprovalInstanceCreatedV1 | ApprovalInstanceCompletedV1,
    eventType: string,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType: 'APPROVAL_INSTANCE',
      objectId,
      operatorUserId: this.actor.actorUserId,
      organizationId: null,
      branchId: null,
      teamId: null,
      payload,
      traceId: this.actor.requestId ?? randomUUID(),
      occurredAt: new Date(),
    };
  }
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** 审批链节点：nodeSchema 数组中单个节点。mode 缺省 'ANY'（SPEC-018：'ALL'=节点内全部通过）。 */
interface ApprovalChainNode {
  name: string;
  approverRule: Prisma.JsonValue;
  mode?: 'ANY' | 'ALL';
}

/** 链构建消费源：视图（ApprovalDefinitionView）与 Prisma 行（ApprovalDefinition）共同满足。 */
interface ApprovalChainSource {
  nodeSchema: Prisma.JsonValue | null;
  approverRule: Prisma.JsonValue;
}

/**
 * 审批链构建（SPEC-016 协调者裁决 #1 + minor 加固 + SPEC-018 mode 校验）：nodeSchema 非空数组
 * → 原样节点链；null/undefined → 合成单节点 [{name:'审批', approverRule: definition.approverRule}]
 * （NULL nodeSchema 单节点向后兼容零回归）。nodeSchema 畸形（空数组 [] 或非数组对象）
 * → ASSIGNEE_INVALID 400（应用层兜底）。SPEC-018：逐节点 mode 若存在且 ∉ {'ANY','ALL'}
 * → ASSIGNEE_INVALID 400（畸形配置防静默——与 definition-service assertNodeSchemaValid 同型本地镜像）。
 */
function buildApprovalChain(definition: ApprovalChainSource): ApprovalChainNode[] {
  if (definition.nodeSchema !== null && definition.nodeSchema !== undefined) {
    // SPEC-016 minor 加固（Task 3 ⚠️②）：非数组对象（如 {"foo":"bar"}）此前静默走单节点回落，
    // 属畸形配置——与空数组同型抛 ASSIGNEE_INVALID 400，防静默降级。
    if (!Array.isArray(definition.nodeSchema)) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approval node schema is malformed');
    }
    const chain = definition.nodeSchema as unknown as ApprovalChainNode[];
    if (chain.length === 0) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approval node schema is empty');
    }
    // SPEC-018：逐节点 mode 校验（缺省 ANY 向后兼容；仅校验显式存在的非法值）。
    for (const node of chain) {
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        const mode = (node as { mode?: unknown }).mode;
        if (mode !== undefined && mode !== 'ANY' && mode !== 'ALL') {
          throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approval node mode is invalid');
        }
      }
    }
    return chain;
  }
  return [{ name: '审批', approverRule: definition.approverRule }];
}

/** Prisma P2002 唯一冲突判定（沿 receivable-service :827 同型本地镜像，零 import 循环）。 */
function isUniqueConflictOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes(field);
}

/** 加签目标 userIds 规范化（SPEC-020 D3）：必填非空数组（1-10 人），每人 1-100，去重。 */
function normalizeAddSignerUserIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  const normalized = value.map(item => normalizeRequiredText(item, 1, 100));
  return [...new Set(normalized)];
}

function normalizePage(value: unknown): number {
  if (value === undefined) return 1;
  const page = normalizeNonNegativeInteger(value);
  if (page < 1) throw new MasterDataError('VALIDATION_FAILED', 400);
  return page;
}

function normalizePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  const pageSize = normalizeNonNegativeInteger(value);
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new MasterDataError('VALIDATION_FAILED', 400);
  return pageSize;
}

/** SPEC-028 全组织视图筛选/搜索 where 构建（仅 role='ALL' 语义）：businessType/status 枚举白名单、
 * applicantId 1-100、keyword 1-100 ILIKE title。非法值 → VALIDATION_FAILED 400。 */
function buildAllViewWhere(where: Prisma.ApprovalInstanceWhereInput, query: {
  businessType?: string;
  status?: string;
  applicantId?: string;
  keyword?: string;
}): void {
  if (query.businessType !== undefined) {
    where.businessType = normalizeAllowedValue(query.businessType, APPROVAL_BUSINESS_TYPES);
  }
  if (query.status !== undefined) {
    where.status = normalizeAllowedValue(query.status, INSTANCE_STATUSES);
  }
  if (query.applicantId !== undefined) {
    where.applicantId = normalizeRequiredText(query.applicantId, 1, 100);
  }
  if (query.keyword !== undefined) {
    where.title = { contains: normalizeRequiredText(query.keyword, 1, 100) };
  }
}

/** SPEC-028 导出 maxRows：正整数 1-10000（缺省 5000 由调用方填默认）。 */
function normalizeExportMaxRows(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10000) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}

/** SPEC-028 CSV 序列化（RFC 4180）：UTF-8 BOM + CRLF；含逗号/引号/换行的字段双引号包裹 + 内部引号翻倍。 */
function toApprovalCsv(rows: readonly ApprovalInstance[]): string {
  const header = ['instanceId', 'businessType', 'title', 'status', 'applicantId', 'currentNode', 'createdAt', 'updatedAt'];
  const lines = rows.map(row => [
    row.id,
    row.businessType,
    row.title,
    row.status,
    row.applicantId,
    String(row.currentNode),
    row.createdAt.toISOString(),
    row.updatedAt.toISOString(),
  ].map(csvField).join(','));
  return `\uFEFF${header.join(',')}\r\n${lines.join('\r\n')}`;
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
