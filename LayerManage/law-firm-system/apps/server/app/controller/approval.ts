import { Controller } from 'egg';

/** Explicit tombstone for saved clients: all new approvals use /workflows. */
export default class ApprovalController extends Controller {
  async retired() {
    this.ctx.status = 410;
    this.ctx.body = {
      code: 410,
      message: '旧审批模式已下线，请进入审批中心使用可视化流程',
      redirect: '/approvals',
    };
  }
}
