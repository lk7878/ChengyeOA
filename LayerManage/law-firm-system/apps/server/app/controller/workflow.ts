import { servePreview } from '../application/files/preview';
import { Controller } from 'egg';
import { WorkflowService } from '../application/workflow/workflow-service';
import {
  AuthorizationContext,
  AuthorizationService,
} from '../application/authorization/authorization-service';
import { CollaborationService } from '../application/collaboration/collaboration-service';
import { check, WorkflowError } from '../domain/workflow/schema';
export default class WorkflowController extends Controller {
  private workflows() {
    return new WorkflowService(this.ctx.prisma, this.ctx.state.authorization as AuthorizationContext);
  }
  private respond(data: unknown) {
    this.ctx.body = { code: 200, message: 'success', data };
  }
  async definitions() {
    this.respond(await this.workflows().definitions(this.ctx.query.manage === 'true'));
  }
  async save() {
    try {
      this.respond(await this.workflows().saveDefinition(this.ctx.params.id, this.ctx.request.body));
    } catch (error) {
      if (!(error instanceof WorkflowError) || !error.location) throw error;
      this.ctx.status = error.status;
      this.ctx.body = { code: error.status, message: error.message, location: error.location };
    }
  }
  async start() {
    this.respond(await this.workflows().start(this.ctx.request.body, this.ctx.get('idempotency-key')));
  }
  async act() {
    this.respond(
      await this.workflows().act(this.ctx.params.id, this.ctx.request.body, this.ctx.get('idempotency-key')),
    );
  }
  async detail() {
    this.respond(await this.workflows().detail(this.ctx.params.id));
  }
  async list() {
    this.respond(
      await this.workflows().list(
        this.ctx.query.role || 'APPLIED',
        Number(this.ctx.query.page) || 1,
        this.ctx.query.keyword,
      ),
    );
  }
  async stats() {
    this.respond(await this.workflows().stats());
  }
  async options() {
    this.respond(await this.workflows().options());
  }
  async tables() {
    new AuthorizationService().requireAction(
      this.ctx.state.authorization as AuthorizationContext,
      'approval.read',
    );
    const c = new CollaborationService(this.ctx.prisma, this.ctx.state.authorization as AuthorizationContext);
    const tables = await this.ctx.prisma.collabTable.findMany({
      where: { archived: false },
      include: { base: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const result: unknown[] = [];
    for (const t of tables) {
      try {
        await c.tableAccess(t.id);
        result.push({ id: t.id, name: t.base.name + ' / ' + t.name });
      } catch (error) {
        if (![403, 404].includes((error as { status: number }).status)) throw error;
      }
    }
    this.respond(result);
  }
  async upload() {
    const stream = await this.ctx.getFileStream();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        stream.destroy();
        check(false, '附件不能超过10MB', 413);
      }
      chunks.push(Buffer.from(chunk));
    }
    this.respond(await this.workflows().upload(stream.filename, Buffer.concat(chunks)));
  }
  async download() {
    const f = await this.workflows().download(this.ctx.params.id, this.ctx.query.instance);
    if (this.ctx.query.preview === '1') return servePreview(this.ctx, f.name, f.bytes);
    this.ctx.set('Cache-Control', 'no-store');
    this.respond({ name: f.name, mime: f.mime, base64: f.bytes.toString('base64') });
  }
}
