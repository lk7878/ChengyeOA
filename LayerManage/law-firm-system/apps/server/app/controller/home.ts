import { Controller } from 'egg';
import * as path from 'path';
import * as fs from 'fs';

export default class HomeController extends Controller {
  public async index() {
    const { ctx } = this;
    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        name: 'law-firm-server',
        version: '1.0.0',
        status: 'running',
        timestamp: Date.now(),
      },
    };
  }

  // SPA fallback：所有非 API 路由返回 index.html
  public async spa() {
    const { ctx } = this;
    const indexPath = path.join(ctx.app.baseDir, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      ctx.type = 'html';
      ctx.body = fs.readFileSync(indexPath, 'utf-8');
    } else {
      ctx.status = 404;
      ctx.body = { code: 404, message: 'Frontend not built. Run: cd apps/web && npm run build' };
    }
  }
}
