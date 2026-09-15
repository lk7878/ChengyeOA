import { Controller } from 'egg';
import { ChannelService } from '../application/channel/channel-service';
import { auditActor } from '../application/master-data/master-data-factory';

export default class ChannelController extends Controller {
  private buildService() {
    return new ChannelService(this.ctx.prisma, auditActor(this.ctx), this.ctx.state.authorization);
  }
  private respond(data: unknown) {
    this.ctx.body = { code: 200, message: 'success', data };
  }
  async identityGaps() {
    this.respond(await this.buildService().identityGaps(this.ctx.query));
  }
  async repairIdentity() {
    this.respond(await this.buildService().repairIdentity(this.ctx.params.id, this.ctx.request.body));
  }
  async index() {
    this.respond(await this.buildService().list(this.ctx.query));
  }
  async show() {
    this.respond(await this.buildService().get(this.ctx.params.id));
  }
  async create() {
    this.respond(await this.buildService().create(this.ctx.request.body));
  }
  async update() {
    this.respond(await this.buildService().update(this.ctx.params.id, this.ctx.request.body));
  }
  async destroy() {
    this.respond(await this.buildService().remove(this.ctx.params.id, this.ctx.request.body));
  }
  async statistics() {
    this.respond(await this.buildService().statistics(this.ctx.params.id));
  }
}
