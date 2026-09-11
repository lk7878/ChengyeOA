import { Controller } from 'egg';
import { employeeReportingLineService } from '../application/master-data/master-data-factory';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys, normalizeRequiredText, normalizeVersion } from '../domain/master-data/master-data-validation';

export default class EmployeeReportingLineController extends Controller {
  async index() {
    this.respond(await employeeReportingLineService(this.ctx).list(this.ctx.params.id));
  }

  async create() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['managerEmployeeId', 'startedAt', 'currentLineVersion']);
    this.respond(await employeeReportingLineService(this.ctx).createOrReplace(this.ctx.params.id, {
      managerEmployeeId: normalizeRequiredText(input.managerEmployeeId, 1, 100),
      startedAt: dateTime(input.startedAt),
      currentLineVersion: input.currentLineVersion === undefined
        ? undefined
        : normalizeVersion(input.currentLineVersion),
    }));
  }

  async end() {
    const input = this.ctx.request.body;
    assertExactKeys(input, ['endedAt', 'version']);
    this.respond(await employeeReportingLineService(this.ctx).end(
      this.ctx.params.id,
      this.ctx.params.lineId,
      { endedAt: dateTime(input.endedAt), version: normalizeVersion(input.version) },
    ));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function dateTime(value: unknown): Date {
  if (typeof value !== 'string') throw new MasterDataError('VALIDATION_FAILED', 400);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new MasterDataError('VALIDATION_FAILED', 400);
  return parsed;
}
