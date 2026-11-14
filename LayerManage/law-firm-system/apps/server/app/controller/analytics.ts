import { Controller } from 'egg';
import { AnalyticsService } from '../application/collaboration/analytics-service';
import { exact } from '../application/collaboration/collaboration-policy';
export default class AnalyticsController extends Controller {
  private analytics() {
    return new AnalyticsService(this.ctx.prisma, this.ctx.state.authorization);
  }
  private respond(data: unknown) {
    this.ctx.body = { code: 200, message: 'success', data };
  }
  async sources() {
    this.respond(await this.analytics().sources());
  }
  async query() {
    this.respond(await this.analytics().query(this.ctx.request.body));
  }
  async index() {
    this.respond(await this.analytics().list());
  }
  async save() {
    this.respond(await this.analytics().save(this.ctx.request.body, this.ctx.params.id));
  }
  async remove() {
    const input = exact(this.ctx.request.body, ['version']);
    this.respond(await this.analytics().remove(this.ctx.params.id, input.version));
  }
}
