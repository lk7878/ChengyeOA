import { Controller } from 'egg';
import { CalendarService } from '../application/calendar/calendar-service';
export default class CalendarController extends Controller {
  private calendarService() { return new CalendarService(this.ctx.prisma, this.ctx.state.authorization); }
  private respond(data: unknown) { this.ctx.body = { code: 200, message: 'success', data }; }
  async index() { this.respond(await this.calendarService().events(this.ctx.query)); }
  async people() { this.respond(await this.calendarService().people(this.ctx.query.keyword)); }
  async show() { this.respond(await this.calendarService().eventDetail(this.ctx.params.id)); }
  async create() { this.respond(await this.calendarService().saveEvent(undefined, this.ctx.request.body, this.ctx.get('idempotency-key'))); }
  async update() { this.respond(await this.calendarService().saveEvent(this.ctx.params.id, this.ctx.request.body, this.ctx.get('idempotency-key'))); }
  async cancel() { this.respond(await this.calendarService().cancel(this.ctx.params.id, this.ctx.request.body, this.ctx.get('idempotency-key'))); }
  async respondInvitation() { this.respond(await this.calendarService().respond(this.ctx.params.id, this.ctx.request.body, this.ctx.get('idempotency-key'))); }
}
