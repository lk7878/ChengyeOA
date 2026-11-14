import { Controller } from 'egg';
import { PayrollService, SavePayrollInput } from '../application/performance/payroll-service';
import { auditActor } from '../application/master-data/master-data-factory';
import { AuthorizationContext } from '../application/authorization/authorization-service';
import { assertExactKeys } from '../domain/master-data/master-data-validation';
import { CaseService } from '../application/case/case-service';

export default class BusinessIntegrationController extends Controller {
  private payroll() {
    return new PayrollService(
      this.ctx.prisma,
      auditActor(this.ctx),
      this.ctx.state.authorization as AuthorizationContext,
    );
  }
  private respond(data: unknown) {
    this.ctx.body = { code: 200, message: 'success', data };
  }
  async payrollList() {
    assertExactKeys(this.ctx.query, ['page']);
    this.respond(await this.payroll().list(Number(this.ctx.query.page ?? 1)));
  }
  async payrollGet() {
    this.respond(await this.payroll().get(this.ctx.params.id));
  }
  async payrollSave() {
    this.respond(await this.payroll().save(this.ctx.request.body as SavePayrollInput, this.ctx.params.id));
  }
  async bindCase() {
    this.respond(
      await new CaseService(
        this.ctx.prisma,
        auditActor(this.ctx),
        this.ctx.state.authorization as AuthorizationContext,
      ).bindFinanceContract(
        this.ctx.params.id,
        this.ctx.request.body as { contractId: string; version: number },
      ),
    );
  }
}
