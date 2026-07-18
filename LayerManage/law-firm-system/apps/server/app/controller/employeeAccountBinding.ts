import { Controller } from 'egg';
import { employeeAccountBindingService } from '../application/master-data/master-data-factory';
import {
  assertExactKeys,
  normalizeRequiredText,
  normalizeVersion,
} from '../domain/master-data/master-data-validation';

export default class EmployeeAccountBindingController extends Controller {
  async update() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['userId', 'employeeVersion']);
    this.respond(await employeeAccountBindingService(this.ctx).bind(this.ctx.params.id, {
      userId: normalizeRequiredText(input.userId, 1, 100),
      employeeVersion: normalizeVersion(input.employeeVersion),
    }));
  }

  async destroy() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['employeeVersion']);
    this.respond(await employeeAccountBindingService(this.ctx).unbind(this.ctx.params.id, {
      employeeVersion: normalizeVersion(input.employeeVersion),
    }));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}
