import {
  deletePortal,
  portalFeed,
  manageList,
  saveDraft,
  publishPortal,
  readAsset,
} from '../application/portal/portal';
import { servePreview } from '../application/files/preview';
import { Controller } from 'egg';
import * as path from 'path';
import * as fs from 'fs';
import { databaseAvailability, databaseHealthResponse } from '../lib/database-health';

export default class HomeController extends Controller {
  public async index() {
    const { ctx } = this;
    const database = await databaseAvailability(ctx.prisma);
    const result = databaseHealthResponse(database);
    ctx.status = result.statusCode;
    ctx.body = result.body;
  }

  private portalResponse(data: unknown) {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = { code: 200, data };
  }
  async portal() {
    this.portalResponse(await portalFeed(this.ctx.prisma, false));
  }
  async publicPortal() {
    this.portalResponse(await portalFeed(this.ctx.prisma, true));
  }
  async portalAdmin() {
    this.portalResponse(await manageList(this.ctx.prisma));
  }
  async portalSave() {
    this.portalResponse(
      await saveDraft(
        this.ctx.prisma,
        this.ctx.state.authorization.userId,
        this.ctx.params.id,
        this.ctx.request.body,
      ),
    );
  }
  async portalPublish() {
    await this.changePublication(true);
  }
  async portalWithdraw() {
    await this.changePublication(false);
  }
  private async changePublication(publish: boolean) {
    await publishPortal(
      this.ctx.prisma,
      this.ctx.params.id,
      this.ctx.request.body.version,
      publish,
      this.ctx.state.authorization.userId,
    );
    this.portalResponse(null);
  }
  async portalDelete() {
    await deletePortal(
      this.ctx.prisma,
      this.ctx.params.id,
      this.ctx.request.body.version,
      this.ctx.state.authorization.userId,
    );
    this.portalResponse(null);
  }
  async portalHistory() {
    this.portalResponse(
      await this.ctx.prisma.portalRevision.findMany({
        where: { entryId: this.ctx.params.id, entry: { deletedAt: null } },
        orderBy: { number: 'desc' },
        include: { image: { select: { id: true, name: true } }, file: { select: { id: true, name: true } } },
      }),
    );
  }
  async portalFile() {
    await this.sendAsset(false);
  }
  async portalDraftFile() {
    await this.sendAsset(false, Number(this.ctx.params.number));
  }
  async publicPhoto() {
    await this.sendAsset(true);
  }
  private async sendAsset(external: boolean, version?: number) {
    const ctx = this.ctx;
    const file = await readAsset(
      ctx.prisma,
      ctx.params.id || String(ctx.query.id ?? ''),
      ctx.params.asset || String(ctx.query.asset ?? ''),
      external,
      version,
    );
    if (!external && ctx.query.preview === '1') return servePreview(ctx, file.name, Buffer.from(file.bytes));
    ctx.set('Cache-Control', 'no-store');
    ctx.set('X-Content-Type-Options', 'nosniff');
    if (!file.mime.startsWith('image/')) ctx.attachment(file.name);
    ctx.type = file.mime;
    ctx.body = Buffer.from(file.bytes);
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
