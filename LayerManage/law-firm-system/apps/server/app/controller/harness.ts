import { Controller } from 'egg';
import { HarnessTicketService } from '../application/harness/harness-ticket-service';
export default class HarnessController extends Controller {
  private harnessService() { return new HarnessTicketService(this.ctx.prisma, (this.app.config as typeof this.app.config & { jwt: { secret: string } }).jwt.secret); }
  async ticket() { this.ctx.set('Cache-Control', 'no-store'); this.ctx.body = { code: 200, message: 'success', data: this.harnessService().issue(this.ctx.request.body, this.ctx.state.user, this.ctx.state.authorization) }; }
  async verify() { this.ctx.set('Cache-Control', 'no-store'); this.ctx.body = { code: 200, message: 'success', data: await this.harnessService().verify(this.ctx.request.body) }; }
}
