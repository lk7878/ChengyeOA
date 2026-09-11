import { randomUUID } from 'node:crypto';
import { Controller } from 'egg';
import { createGovernanceServicesForContext } from '../application/admin-governance/governance-factory';
import { GovernanceListQuery } from '../application/admin-governance/governance-query-service';
import { AuthorizationContext } from '../application/authorization/authorization-service';

export default class AdminGovernanceController extends Controller {
  async catalog() {
    this.respond(this.services().query.catalog(this.authorization()));
  }

  async create() {
    this.respond(await this.services().command.create(
      this.authorization(),
      this.ctx.request.body,
      this.requestId(),
      this.stepUpAuthorization(),
    ));
  }

  async targetUsers() {
    this.respond(await this.services().query.userTargets(
      this.authorization(),
      this.ctx.query.keyword,
    ));
  }

  async index() {
    this.respond(await this.services().query.list(
      this.authorization(),
      this.ctx.query as unknown as GovernanceListQuery,
    ));
  }

  async show() {
    this.respond(await this.services().query.detail(
      this.authorization(),
      this.ctx.params.id,
      this.ctx.ip,
    ));
  }

  async review() {
    this.respond(await this.services().review.review(
      this.authorization(),
      this.ctx.params.id,
      this.ctx.request.body,
      this.requestId(),
      this.stepUpAuthorization(),
    ));
  }

  async cancel() {
    this.respond(await this.services().command.cancel(
      this.authorization(),
      this.ctx.params.id,
      this.ctx.request.body,
      this.requestId(),
    ));
  }

  async retry() {
    this.respond(await this.services().review.resume(
      this.authorization(),
      this.ctx.params.id,
      this.ctx.request.body,
      this.requestId(),
      this.stepUpAuthorization(),
    ));
  }

  private services() {
    return createGovernanceServicesForContext(this.ctx);
  }

  private authorization(): AuthorizationContext {
    return this.ctx.state.authorization as AuthorizationContext;
  }

  private requestId(): string {
    return this.ctx.get('x-request-id').trim() || randomUUID();
  }

  private stepUpAuthorization() {
    return {
      claims: this.ctx.state.user,
      token: this.ctx.get('x-step-up-token').trim(),
    };
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}
