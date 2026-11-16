import { Controller } from 'egg';

import type { AuthorizationContext } from '../application/authorization/authorization-service';
import { EventOperationsService } from '../application/events/event-operations-service';
import { createEventServices } from '../application/events/event-services-factory';
import { authorizationInputError } from '../domain/authorization/authorization-errors';

export default class EventOperationsController extends Controller {
  async summary() {
    this.respond(await this.operationsService().summary(this.authorization()));
  }

  async index() {
    this.respond(await this.operationsService().list(this.authorization(), this.ctx.query));
  }

  async show() {
    this.respond(await this.operationsService().detail(this.authorization(), this.ctx.params.id));
  }

  async subscriptions() {
    this.respond(await this.operationsService().subscriptions(this.authorization()));
  }

  async retry() {
    const body = this.ctx.request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'expectedVersion')) {
      authorizationInputError();
    }
    this.respond(await this.operationsService().retry(
      this.authorization(),
      this.ctx.params.id,
      (body as { expectedVersion?: unknown }).expectedVersion as number,
      {
        claims: this.ctx.state.user,
        ip: this.ctx.ip,
      },
    ));
  }

  private operationsService(): EventOperationsService {
    const events = createEventServices(this.ctx.prisma, this.ctx.app.config.eventWorker, {
      observability: this.ctx.app.config.eventObservability,
      // SPEC-009 Task 10（R-10g/I-1 根治）：与 app.ts:41 启动钩子签名逐字一致，
      // 非默认 LEAD_RECYCLE_* 环境下缺省会触发服务签名不一致 fail-fast。
      leadRecycle: this.ctx.app.config.leadRecycle,
      // SPEC-021 Task 2：审批超时扫描器随事件 worker tick 节律运行（同源注入，沿 leadRecycle）。
      approvalTimeout: this.ctx.app.config.approvalTimeout,
    });
    return new EventOperationsService({
      prisma: this.ctx.prisma,
      registry: events.registry,
      health: events.health,
      snapshotReader: events.snapshotReader,
      observability: this.ctx.app.config.eventObservability,
      workerEnabled: this.ctx.app.config.eventWorker.enabled,
    });
  }

  private authorization(): AuthorizationContext {
    return this.ctx.state.authorization as AuthorizationContext;
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}
