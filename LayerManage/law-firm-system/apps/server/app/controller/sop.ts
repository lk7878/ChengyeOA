import { SopSubmissionService } from '../application/sop/submission-service';
import { SopSourceFileService } from '../application/sop/source-file-service';
import { SopContinuationService } from '../application/sop/continuation-service';
import { SopExecutionService } from '../application/sop/execution-service';
import { Controller } from 'egg';
import { SopTemplateService } from '../application/sop/template-service';
import { auditActor } from '../application/master-data/master-data-factory';
import { SOP_PRESETS } from '../domain/sop/template-content';
export default class SopController extends Controller {
  private sourceFiles() { return new SopSourceFileService(this.ctx.prisma,auditActor(this.ctx),this.ctx.state.authorization); }
  private continuationService() { return new SopContinuationService(this.ctx.prisma,auditActor(this.ctx),this.ctx.state.authorization); }
  async sourceContext() { this.respond(await this.execution().sourceContext(this.ctx.query)); }
  async sourceMaterials() { this.respond(await this.sourceFiles().list(this.ctx.params.id,this.ctx.query)); }
  async uploadSourceMaterial() { this.respond(await this.sourceFiles().upload(this.ctx.params.id,this.ctx.request.body)); }
  async sourceMaterial() { this.respond(await this.sourceFiles().download(this.ctx.params.id,this.ctx.params.fileId)); }
  async continuations() { this.respond(await this.continuationService().list(this.ctx.params.id)); }
  async continuationOptions() { this.respond(await this.continuationService().options(this.ctx.params.id)); }
  async continueInstance() { this.respond(await this.continuationService().create(this.ctx.params.id,this.ctx.request.body)); }
  private submissionsService() { return new SopSubmissionService(this.ctx.prisma,auditActor(this.ctx),this.ctx.state.authorization); }
  async submissions() { this.respond(await this.submissionsService().list(this.ctx.params.id)); }
  async material() { this.respond(await this.submissionsService().downloadMaterial(this.ctx.params.id,this.ctx.params.fileId)); }
  async submission() { this.respond(await this.submissionsService().get(this.ctx.params.id)); }
  async submit() { this.respond(await this.submissionsService().submit(this.ctx.params.id,this.ctx.request.body)); }
  async assignReview() { this.respond(await this.submissionsService().assign(this.ctx.params.id,this.ctx.request.body)); }
  async reviewChecklist() { this.respond(await this.submissionsService().checklist(this.ctx.params.id,this.ctx.request.body)); }
  async reviewOptions() { this.respond(await this.submissionsService().options(this.ctx.params.id)); }
  async materialOptions() { this.respond(await this.submissionsService().materialOptions(this.ctx.params.id,this.ctx.query)); }
  async guidance() { this.respond(await this.submissionsService().guidance(this.ctx.params.id)); }
  async guide() { this.respond(await this.submissionsService().guide(this.ctx.params.id,this.ctx.request.body)); }
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
