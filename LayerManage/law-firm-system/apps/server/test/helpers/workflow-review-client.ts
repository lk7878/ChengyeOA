import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { WorkflowService } from '../../app/application/workflow/workflow-service';

/** Exercise the real visual engine from existing domain-review fixtures. */
export class WorkflowReviewClient extends WorkflowService {
  constructor(db: PrismaClient, _actor: { actorUserId: string }, context: AuthorizationContext) {
    super(db, context);
  }
  async processTask(taskId: string, input: { action: string; remark?: string }) {
    const task = await this.db.workflowTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { instance: true },
    });
    return this.act(task.instanceId, { ...input, version: task.instance.version }, randomUUID());
  }
  async forwardTask(taskId: string, input: { forwardToUserId: string }) {
    const task = await this.db.workflowTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { instance: true },
    });
    return this.act(
      task.instanceId,
      { action: 'FORWARD', version: task.instance.version, userIds: [input.forwardToUserId] },
      randomUUID(),
    );
  }
  async withdrawInstance(id: string, input: { reason: string }) {
    const instance = await this.db.workflowInstance.findUniqueOrThrow({ where: { id } });
    return this.act(
      id,
      { action: 'WITHDRAW', version: instance.version, remark: input.reason },
      randomUUID(),
    );
  }
}
