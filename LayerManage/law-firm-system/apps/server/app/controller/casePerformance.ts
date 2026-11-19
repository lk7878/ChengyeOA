import { Controller } from 'egg';
import { SettlementService } from '../application/performance/settlement-service';
import { bindEarnings, markPaid, releaseEarnings } from '../application/performance/settlement-payroll';

export default class CasePerformanceController extends Controller {
  private settlements() {
    return new SettlementService(this.ctx.prisma, this.ctx.state.authorization);
  }
  private ok(data: unknown) {
    this.ctx.body = { code: 200, message: 'success', data: data ?? null };
  }
  async index() {
    this.ok(await this.settlements().view(this.ctx.query.period));
  }
  async sources() {
    this.ok(
      await this.settlements().sources(
        String(this.ctx.query.q ?? '')
          .trim()
          .slice(0, 100),
      ),
    );
  }
  async recipients() {
    this.ok(await this.settlements().recipients(this.ctx.params.id, String(this.ctx.query.q ?? '').trim().slice(0, 100)));
  }
  async policy() {
    this.ok(await this.settlements().policy(this.ctx.request.body));
  }
  async save() {
    this.ok(await this.settlements().save(this.ctx.request.body));
  }
  async action() {
    this.ok(await this.settlements().action(this.ctx.params.id, this.ctx.request.body));
  }
  async payroll() {
    this.ok(await bindEarnings(this.settlements(), this.ctx.params.id, this.ctx.request.body));
  }
  async release() {
    this.ok(await releaseEarnings(this.settlements(), this.ctx.params.id, this.ctx.request.body));
  }
  async paid() {
    this.ok(await markPaid(this.settlements(), this.ctx.params.id));
  }
}
