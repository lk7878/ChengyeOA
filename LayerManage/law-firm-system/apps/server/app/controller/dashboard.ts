import { Controller } from 'egg';
import { DashboardService } from '../application/dashboard/dashboard-service';

export default class DashboardController extends Controller {
  private buildService() {
    return new DashboardService(this.ctx.prisma, this.ctx.state.authorization);
  }
  private respond(data: unknown) {
    this.ctx.body = { code: 200, message: 'success', data };
  }
  async metrics() {
    this.respond(await this.buildService().metrics());
  }
  async funnel() {
    this.respond(await this.buildService().funnel());
  }
  async teamMetrics() {
    this.respond(await this.buildService().teamMetrics());
  }
  async financeMetrics() {
    this.respond(await this.buildService().financeMetrics());
  }
  async caseMetrics() {
    this.respond(await this.buildService().caseMetrics());
  }
  async alerts() {
    this.respond(await this.buildService().alerts());
  }
}
