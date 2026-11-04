import { Controller } from 'egg';
import { choice, exact } from '../application/collaboration/collaboration-policy';

const defaults = { fontSize: 'standard', background: 'default', rowHeight: 'standard' };

/** Only the authenticated account can read or write its presentation preferences. */
export default class AppearanceController extends Controller {
  async show() {
    const user = await this.ctx.prisma.user.findUniqueOrThrow({
      where: { id: this.ctx.state.user.userId }, select: { appearance: true },
    });
    const saved = user.appearance;
    const data = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...defaults, ...saved } : defaults;
    this.ctx.body = { code: 200, message: 'success', data };
  }

  async save() {
    const input = exact(this.ctx.request.body, ['fontSize', 'background', 'rowHeight']);
    const data = {
      fontSize: choice(input.fontSize, ['standard', 'large', 'extraLarge']),
      background: choice(input.background, ['default', 'beige', 'green']),
      rowHeight: choice(input.rowHeight, ['compact', 'standard', 'comfortable']),
    };
    await this.ctx.prisma.user.update({ where: { id: this.ctx.state.user.userId }, data: { appearance: data } });
    this.ctx.body = { code: 200, message: 'success', data };
  }
}
