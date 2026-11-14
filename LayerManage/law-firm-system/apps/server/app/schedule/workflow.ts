import { Subscription } from 'egg';
import { tickWorkflows } from '../application/workflow/workflow-worker';
export default class WorkflowSchedule extends Subscription {
  static get schedule() {
    return { interval: '1m', type: 'worker', disable: process.env.EGG_SERVER_ENV === 'unittest' };
  }
  async subscribe() {
    await tickWorkflows(this.ctx.prisma);
  }
}
