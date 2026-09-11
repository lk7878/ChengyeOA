import { Controller } from 'egg';
import { ApprovalSyncService } from '../application/approval/approval-sync-service';
import { PayrollService, SavePayrollInput } from '../application/performance/payroll-service';
import { auditActor } from '../application/master-data/master-data-factory';
import { AuthorizationContext } from '../application/authorization/authorization-service';
import { assertExactKeys } from '../domain/master-data/master-data-validation';
import { CaseService } from '../application/case/case-service';

export default class BusinessIntegrationController extends Controller {
  private sync() { return new ApprovalSyncService(this.ctx.prisma, auditActor(this.ctx), this.ctx.state.authorization as AuthorizationContext); }
  private payroll() { return new PayrollService(this.ctx.prisma, auditActor(this.ctx), this.ctx.state.authorization as AuthorizationContext); }
  private respond(data: unknown) { this.ctx.body = { code: 200, message: 'success', data }; }
  async ledger() { assertExactKeys(this.ctx.query, ['target', 'page']); this.respond(await this.sync().list(this.ctx.query.target, Number(this.ctx.query.page ?? 1))); }
  async retry() { assertExactKeys(this.ctx.request.body, []); this.respond(await this.sync().retry(this.ctx.params.id)); }
  async rules() { this.respond(await this.sync().rules()); }
  async setRule() { assertExactKeys(this.ctx.request.body, ['target']); this.respond(await this.sync().setRule(this.ctx.params.id, this.ctx.request.body.target as string)); }
  async payrollList() { assertExactKeys(this.ctx.query, ['page']); this.respond(await this.payroll().list(Number(this.ctx.query.page ?? 1))); }
  async payrollSave() { this.respond(await this.payroll().save(this.ctx.request.body as SavePayrollInput, this.ctx.params.id)); }
  async bindCase() { this.respond(await new CaseService(this.ctx.prisma, auditActor(this.ctx), this.ctx.state.authorization as AuthorizationContext).bindFinanceContract(this.ctx.params.id, this.ctx.request.body as { contractId: string; version: number })); }
}
