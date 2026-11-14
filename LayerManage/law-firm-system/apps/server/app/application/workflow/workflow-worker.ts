import { createHmac } from 'node:crypto';
import https from 'node:https';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { check, WorkflowSchema } from '../../domain/workflow/schema';
import { hookConfiguration, WorkflowService } from './workflow-service';

/** Only operator-configured destinations, no redirects, bounded body/time and signed delivery ID. */
export async function sendWorkflowHook(name: string, deliveryId: string, payload: unknown) {
  const hook = hookConfiguration()[name];
  check(hook && typeof hook.secret === 'string' && hook.secret.length >= 32, '自动化接口未配置有效密钥');
  const url = new URL(hook.url);
  check(url.protocol === 'https:' && !url.username && !url.password, '自动化接口必须使用无凭据的HTTPS地址');
  const body = JSON.stringify(payload);
  check(Buffer.byteLength(body) <= 500000, '自动化消息过大');
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', hook.secret)
    .update(`${timestamp}.${deliveryId}.${body}`)
    .digest('hex');
  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Workflow-Delivery': deliveryId,
          'X-Workflow-Timestamp': timestamp,
          'X-Workflow-Signature': signature,
        },
      },
      (res) => {
        res.resume();
        if (res.statusCode! >= 200 && res.statusCode! < 300) resolve();
        else reject(new Error(`接口返回HTTP ${res.statusCode}`));
      },
    );
    req.on('timeout', () => req.destroy(new Error('接口超时')));
    req.on('error', reject);
    req.end(body);
  });
}

export async function tickWorkflows(db: PrismaClient, now = new Date(), send = sendWorkflowHook) {
  // Each command locks its instance and verifies the version, safe across multiple workers.
  const tasks = await db.workflowTask.findMany({
    where: { status: 'PENDING', dueAt: { lte: now }, instance: { status: 'PENDING' } },
    include: { instance: true },
    orderBy: { dueAt: 'asc' },
    take: 50,
  });
  for (const task of tasks) {
    const i = task.instance,
      s = i.snapshot as unknown as WorkflowSchema,
      n = s.nodes.find((n) => n.id === task.nodeId);
    try {
      if (n?.timeoutAction === 'APPROVE') {
        const actor = await new AuthorizationContextLoader(db).load(task.assigneeId);
        await new WorkflowService(db, actor).act(
          i.id,
          { action: 'APPROVE', version: i.version, remark: '按发布版本中配置的超时规则自动同意' },
          `timeout:${task.id}`,
          true,
        );
      } else {
        const actor = await new AuthorizationContextLoader(db).load(task.assigneeId);
        await new WorkflowService(db, actor).detail(i.id);
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM workflow_instance WHERE id=${i.id} FOR UPDATE`;
          if (
            !(await tx.workflowTask.count({
              where: { id: task.id, status: 'PENDING', instance: { status: 'PENDING' } },
            }))
          )
            return;
          const day = now.toISOString().slice(0, 10),
            deduplicationKey = `workflow:timeout:${task.id}:${day}`;
          await tx.notification.upsert({
            where: { deduplicationKey },
            create: {
              deduplicationKey,
              userId: task.assigneeId,
              type: 'APPROVAL',
              title: '审批任务超时提醒',
              content: i.title,
              relatedId: i.id,
              relatedType: 'WORKFLOW',
              routeUrl: `/approvals?instance=${i.id}`,
            },
            update: {},
          });
          await tx.workflowTask.update({
            where: { id: task.id },
            data: { dueAt: new Date(now.getTime() + 86400000) },
          });
        });
      }
    } catch {
      // Invalid/revoked actors or incomplete required fields never get silently approved.
      // Back off failures so one broken task cannot starve later tasks.
      await db.workflowTask.updateMany({
        where: { id: task.id, status: 'PENDING', dueAt: task.dueAt },
        data: { dueAt: new Date(now.getTime() + 3600000) },
      });
      const deduplicationKey = `workflow:timeout-failed:${task.id}:${now.toISOString().slice(0, 10)}`;
      await db.notification.upsert({
        where: { deduplicationKey },
        create: {
          deduplicationKey,
          userId: i.applicantId,
          type: 'APPROVAL',
          title: '审批自动处理未完成，请核对人员权限和必填字段',
          content: i.title,
          routeUrl: `/approvals?instance=${i.id}`,
        },
        update: {},
      });
    }
  }
  // A process may stop during its final leased attempt; do not leave it permanently SENDING.
  await db.workflowDelivery.updateMany({
    where: { status: 'SENDING', nextAt: { lte: now }, attempts: { gte: 8 } },
    data: { status: 'FAILED', error: '最后一次接口投递未能确认完成，请按投递编号核对接收服务' },
  });
  const deliveries = await db.workflowDelivery.findMany({
    where: { status: { in: ['PENDING', 'SENDING'] }, nextAt: { lte: now }, attempts: { lt: 8 } },
    orderBy: { nextAt: 'asc' },
    take: 20,
  });
  for (const d of deliveries) {
    const claimed = await db.workflowDelivery.updateMany({
      where: { id: d.id, status: d.status, nextAt: d.nextAt, attempts: d.attempts },
      data: { status: 'SENDING', attempts: { increment: 1 }, nextAt: new Date(now.getTime() + 60000) },
    });
    if (!claimed.count) continue;
    try {
      const i = await db.workflowInstance.findUniqueOrThrow({ where: { id: d.instanceId } });
      // Emit metadata only. Consumers must fetch authorized data through OA APIs; private fields never leave in a webhook.
      await send(d.hook, d.id, {
        event: 'workflow.completed',
        instanceId: i.id,
        definitionId: i.definitionId,
        definitionVersion: i.definitionVersion,
        status: i.status,
        syncStatus: i.syncStatus,
        finishedAt: i.finishedAt,
      });
      await db.workflowDelivery.update({ where: { id: d.id }, data: { status: 'SENT', error: null } });
    } catch {
      await db.workflowDelivery.update({
        where: { id: d.id },
        data: {
          status: d.attempts + 1 >= 8 ? 'FAILED' : 'PENDING',
          error: '自动化接口投递失败，请检查服务端接口配置或目标服务',
          nextAt: new Date(now.getTime() + Math.min(3600, 2 ** d.attempts * 30) * 1000),
        },
      });
    }
  }
}
