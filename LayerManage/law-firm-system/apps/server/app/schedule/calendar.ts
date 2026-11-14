import { Subscription } from 'egg';
import { deliverCalendarReminders } from '../application/calendar/calendar-service';
export default class CalendarSchedule extends Subscription {
  static get schedule() {
    return { interval: '30s', type: 'worker', immediate: true, disable: process.env.EGG_SERVER_ENV === 'unittest' };
  }
  async subscribe() { await deliverCalendarReminders(this.ctx.prisma); }
}
