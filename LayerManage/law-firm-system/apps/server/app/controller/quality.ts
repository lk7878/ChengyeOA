import { servePreview } from '../application/files/preview';
import { AnalysisService } from '../application/quality/analysis-service';
import { Controller } from 'egg';
import { QualityService } from '../application/quality/quality-service';
import { auditActor } from '../application/master-data/master-data-factory';
export default class QualityController extends Controller {
  private analysisService(){return new AnalysisService(this.ctx.prisma,auditActor(this.ctx),this.ctx.state.authorization);}
  async assessments(){this.respond(await this.analysisService().assessments(this.ctx.params.id));}
  async assess(){this.respond(await this.analysisService().createAssessment(this.ctx.params.id,this.ctx.request.body));}
  async analyses(){this.respond(await this.analysisService().list(this.ctx.query));}
  async analysis(){this.respond(await this.analysisService().get(this.ctx.params.id));}
  async saveAnalysis(){this.respond(await this.analysisService().save(this.ctx.params.id,this.ctx.request.body));}
  async analysisReviewers(){this.respond(await this.analysisService().reviewers(this.ctx.params.id));}
  async closeAnalysis(){this.respond(await this.analysisService().requestClose(this.ctx.params.id,this.ctx.request.body));}
  async metrics(){this.respond(await this.analysisService().metrics());}
  private qualityService() {
    return new QualityService(this.ctx.prisma, auditActor(this.ctx), this.ctx.state.authorization);
  }
  private respond(data: unknown) {
    this.ctx.body = { code: 200, message: 'success', data };
  }
  async options() {
    this.respond(await this.qualityService().options());
  }
  async policies() {
    this.respond(await this.qualityService().policies(this.ctx.query));
  }
  async createPolicy() {
    this.respond(await this.qualityService().createPolicy(this.ctx.request.body));
  }
  async runs() {
    this.respond(await this.qualityService().runs(this.ctx.query));
  }
  async createRun() {
    this.respond(await this.qualityService().createRun(this.ctx.request.body));
  }
  async run() {
    this.respond(await this.qualityService().run(this.ctx.params.id));
  }
  async inspection() {
    this.respond(await this.qualityService().inspection(this.ctx.params.id));
  }
  async inspections() {
    this.respond(await this.qualityService().inspections(this.ctx.query));
  }
  async inspect() {
    this.respond(await this.qualityService().inspect(this.ctx.params.id, this.ctx.request.body));
  }
  async issues() {
    this.respond(await this.qualityService().issues(this.ctx.query));
  }
  async issue() {
    this.respond(await this.qualityService().issue(this.ctx.params.id));
  }
  async act() {
    this.respond(await this.qualityService().act(this.ctx.params.id, this.ctx.request.body));
  }
  async assignees() {
    this.respond(await this.qualityService().assignees(this.ctx.params.id));
  }
  async materials() {
    this.respond(await this.qualityService().materialOptions(this.ctx.params.id));
  }
  async download() {
    const file = await this.qualityService().download(this.ctx.params.id, this.ctx.params.fileId);
    if (this.ctx.query.preview === '1') return servePreview(this.ctx, file.fileName, Buffer.from(file.base64, 'base64'));
    this.respond(file);
  }
}
