import { SopExecutionService } from '../application/sop/execution-service';
import { Controller } from 'egg';
import { SopTemplateService } from '../application/sop/template-service';
import { auditActor } from '../application/master-data/master-data-factory';
import { SOP_PRESETS } from '../domain/sop/template-content';
export default class SopController extends Controller {
  private execution() {
    return new SopExecutionService(this.ctx.prisma, auditActor(this.ctx), this.ctx.state.authorization);
  }
  async instances() {
    this.respond(await this.execution().instances(this.ctx.query));
  }
  async startInstance() {
    this.respond(await this.execution().start(this.ctx.request.body));
  }
  async instance() {
    this.respond(await this.execution().instance(this.ctx.params.id));
  }
  async instanceAction() {
    this.respond(await this.execution().instanceAction(this.ctx.params.id, this.ctx.request.body));
  }
  async tasks() {
    this.respond(await this.execution().tasks(this.ctx.query));
  }
  async task() {
    this.respond(await this.execution().task(this.ctx.params.id));
  }
  async taskAction() {
    this.respond(await this.execution().taskAction(this.ctx.params.id, this.ctx.request.body));
  }
  async taskOptions() {
    this.respond(await this.execution().options());
  }
  private buildService() {
    return new SopTemplateService(this.ctx.prisma, auditActor(this.ctx), this.ctx.state.authorization);
  }
  private respond(data: unknown) {
    this.ctx.body = { code: 200, message: 'success', data };
  }
  async templates() {
    this.respond(await this.buildService().list(this.ctx.query));
  }
  async template() {
    this.respond(await this.buildService().get(this.ctx.params.id));
  }
  async templateVersion() {
    this.respond(await this.buildService().getByVersion(this.ctx.params.id));
  }
  async createTemplate() {
    this.respond(await this.buildService().create(this.ctx.request.body));
  }
  async copyVersion() {
    this.respond(await this.buildService().copyVersion(this.ctx.params.id, this.ctx.request.body));
  }
  async updateVersion() {
    this.respond(await this.buildService().updateVersion(this.ctx.params.id, this.ctx.request.body));
  }
  async options() {
    this.respond(await this.buildService().options());
  }
  async presets() {
    this.respond(SOP_PRESETS);
  }
}
