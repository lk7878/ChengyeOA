import { Controller } from 'egg';
import { CaseSealService } from '../application/case/seal-service';
export default class CaseSealController extends Controller {
  private sealService() { return new CaseSealService(this.ctx.prisma, this.ctx.state.authorization); }
  private respond(data: unknown) { this.ctx.body = { code: 200, message: 'success', data }; }
  async index() { this.respond(await this.sealService().list(this.ctx.query)); }
  async detail() { this.respond(await this.sealService().detail(this.ctx.params.id)); }
  async correct() { this.respond(await this.sealService().correctNumber(this.ctx.params.id, this.ctx.request.body)); }
  async stamp() { this.respond(await this.sealService().stamp(this.ctx.params.id, this.ctx.request.body)); }
  async file() { this.respond(await this.sealService().file(this.ctx.params.id, this.ctx.params.fileId)); }
}
