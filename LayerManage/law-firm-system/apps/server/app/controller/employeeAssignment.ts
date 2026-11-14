import { Controller } from 'egg';
import { employeeAssignmentService } from '../application/master-data/master-data-factory';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeRequiredText,
  normalizeVersion,
} from '../domain/master-data/master-data-validation';

export default class EmployeeAssignmentController extends Controller {
  async transfer() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['organizationId', 'positionId', 'employeeVersion']);
    this.respond(await employeeAssignmentService(this.ctx).transferPrimary(this.ctx.params.id, {
      organizationId: normalizeRequiredText(input.organizationId, 1, 100),
      positionId: normalizeRequiredText(input.positionId, 1, 100),
      employeeVersion: normalizeVersion(input.employeeVersion),
    }));
  }

  async create() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['organizationId', 'positionId', 'assignmentType']);
    this.respond(await employeeAssignmentService(this.ctx).add(this.ctx.params.id, {
      organizationId: normalizeRequiredText(input.organizationId, 1, 100),
      positionId: normalizeRequiredText(input.positionId, 1, 100),
      assignmentType: normalizeAllowedValue(input.assignmentType, ['SECONDARY', 'ACTING'] as const),
    }));
  }

  async end() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['version']);
    this.respond(await employeeAssignmentService(this.ctx).end(
      this.ctx.params.id,
      this.ctx.params.assignmentId,
      { version: normalizeVersion(input.version) },
    ));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}
