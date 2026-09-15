import { Controller } from 'egg';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AuthorizationContext } from '../application/authorization/authorization-service';
import { createAuthorizationContextLoader } from '../application/authorization/authorization-factory';
import { createAuthenticationService } from '../application/auth/authentication-factory';
import { CollaborationService } from '../application/collaboration/collaboration-service';
import { exact, fail, text } from '../application/collaboration/collaboration-policy';

export default class CollaborationController extends Controller {
  private collaborationService() {
    return new CollaborationService(this.ctx.prisma, this.ctx.state.authorization as AuthorizationContext);
  }
  private key() {
    return this.ctx.get('idempotency-key');
  }
  private respond(data: unknown) {
    this.ctx.body = {
      code: 200,
      message: 'success',
      data,
      requestId: this.ctx.get('x-request-id') || randomUUID(),
    };
  }
  async index() {
    this.respond(await this.collaborationService().listWorkspaces());
  }
  async createWorkspace() {
    this.respond(await this.collaborationService().createWorkspace(this.ctx.request.body, this.key()));
  }
  async createBase() {
    this.respond(
      await this.collaborationService().createBase(
        this.ctx.params.workspaceId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async options() {
    this.respond(await this.collaborationService().options(this.ctx.query.workspaceId));
  }
  async members() {
    this.respond(await this.collaborationService().members(this.ctx.params.workspaceId));
  }
  async saveMember() {
    this.respond(
      await this.collaborationService().saveMember(
        this.ctx.params.workspaceId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async resourceAccess() {
    this.respond(
      await this.collaborationService().resourceAccess(
        this.ctx.params.tableId ? 'TABLE' : 'BASE',
        this.ctx.params.tableId || this.ctx.params.baseId,
      ),
    );
  }
  async saveResourceAccess() {
    this.respond(
      await this.collaborationService().saveResourceAccess(
        this.ctx.params.tableId ? 'TABLE' : 'BASE',
        this.ctx.params.tableId || this.ctx.params.baseId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async tables() {
    this.respond(await this.collaborationService().listTables(this.ctx.params.baseId));
  }
  async createTable() {
    this.respond(
      await this.collaborationService().createTable(
        this.ctx.params.baseId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async table() {
    this.respond(await this.collaborationService().describe(this.ctx.params.tableId));
  }
  async mutateTable() {
    this.respond(
      await this.collaborationService().mutateTable(
        this.ctx.params.tableId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async field() {
    this.respond(
      await this.collaborationService().saveField(
        this.ctx.params.tableId,
        this.ctx.params.fieldId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async view() {
    this.respond(
      await this.collaborationService().saveView(
        this.ctx.params.tableId,
        this.ctx.params.viewId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async query() {
    this.respond(await this.collaborationService().query(this.ctx.params.tableId, this.ctx.request.body));
  }
  async record() {
    this.respond(await this.collaborationService().record(this.ctx.params.tableId, this.ctx.params.recordId));
  }
  async businessDetail() {
    this.respond(
      await this.collaborationService().businessDetail(this.ctx.params.tableId, this.ctx.params.recordId, {
        page: this.ctx.query.page ? Number(this.ctx.query.page) : 1,
      }),
    );
  }
  async businessAction() {
    this.respond(
      await this.collaborationService().businessAction(
        this.ctx.params.tableId,
        this.ctx.params.recordId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async saveRecords() {
    this.respond(await this.collaborationService().saveRecords(this.ctx.params.tableId, this.ctx.request.body, this.key()));
  }
  async saveRecord() {
    this.respond(
      await this.collaborationService().saveRecord(
        this.ctx.params.tableId,
        this.ctx.params.recordId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }

  async events() {
    const ctx = this.ctx;
    const baseId = text(ctx.query.baseId);
    const service = this.collaborationService();
    await service.baseAccess(baseId);
    const tableId = ctx.query.tableId ? text(ctx.query.tableId) : undefined;
    if (tableId && (await service.tableAccess(tableId)).table.baseId !== baseId)
      fail('COLLAB_NOT_FOUND', 404);
    const connectionId = randomUUID();
    const userId = ctx.state.user.userId as string;
    const token = ctx.get('authorization').slice(7);
    const stream = new PassThrough();
    let closed = false;
    let running = false;
    let businessRefreshAt = 0;
    let permissionSnapshot = '';
    const latest = await ctx.prisma.collabEvent.findFirst({
      where: { baseId },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    let cursor = latest?.id ?? 0n;
    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache, no-transform');
    ctx.set('X-Accel-Buffering', 'no');
    ctx.body = stream;
    const emit = (event: string, data: unknown) =>
      stream.write(`id: ${cursor}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      stream.end();
      void ctx.prisma.collabPresence.deleteMany({ where: { baseId, connectionId } }).catch((): void => {});
    };
    const tick = async () => {
      if (closed || running) return;
      running = true;
      try {
        await createAuthenticationService(ctx).authenticate(token);
        const authorization = await createAuthorizationContextLoader(ctx).load(userId);
        const current = new CollaborationService(ctx.prisma, authorization);
        await current.baseAccess(baseId);
        if (tableId) {
          const selected = await current.tableAccess(tableId);
          const snapshot = JSON.stringify({
            access: selected.access,
            grants: authorization.grants,
            fieldRules: authorization.fieldRules,
          });
          if (permissionSnapshot && snapshot !== permissionSnapshot)
            emit('invalidate', { baseId, kind: 'access.updated' });
          permissionSnapshot = snapshot;
          // Existing CRM writes do not all publish collaboration events (e.g. immutable follows).
          // A bounded refresh catches these writes without broadcasting business data.
          if (selected.table.source !== 'CUSTOM' && Date.now() - businessRefreshAt >= 5000) {
            businessRefreshAt = Date.now();
            emit('invalidate', { baseId, kind: 'business.refresh' });
          }
        }
        await ctx.prisma.collabPresence.upsert({
          where: { baseId_connectionId: { baseId, connectionId } },
          create: { baseId, connectionId, userId },
          update: { seenAt: new Date() },
        });
        const event = await ctx.prisma.collabEvent.findFirst({
          where: { baseId, id: { gt: cursor } },
          orderBy: { id: 'desc' },
          select: { id: true, kind: true },
        });
        // No record IDs or values are broadcast: the client re-queries with current authorization.
        if (event) {
          const accessChanged = await ctx.prisma.collabEvent.count({
            where: { baseId, id: { gt: cursor }, kind: 'access.updated' },
          });
          cursor = event.id;
          emit('invalidate', { baseId, kind: accessChanged ? 'access.updated' : event.kind });
        }
        const presence = await ctx.prisma.collabPresence.findMany({
          where: { baseId, seenAt: { gt: new Date(Date.now() - 6000) } },
          distinct: ['userId'],
          select: { userId: true },
        });
        const users = await ctx.prisma.user.findMany({
          where: { id: { in: presence.map((p) => p.userId) }, status: 'ENABLED' },
          select: { id: true, username: true, employee: { select: { name: true } } },
        });
        if (!closed)
          emit('presence', { users: users.map((u) => ({ id: u.id, name: u.employee?.name || u.username })) });
      } catch (error) {
        const code = (error as { code?: string }).code || '';
        if (
          !closed &&
          [
            'COLLAB_FORBIDDEN',
            'COLLAB_NOT_FOUND',
            'SESSION_REVOKED',
            'USER_DISABLED',
            'MFA_REQUIRED',
          ].includes(code)
        )
          emit('revoked', {});
        close();
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, 1000);
    ctx.res.once('close', close);
    stream.once('error', close);
    emit('ready', { baseId }); // A ready event always asks the client for a fresh authorized snapshot.
    void tick();
  }

  async upload() {
    const tableId = this.ctx.params.tableId;
    await this.collaborationService().tableAccess(tableId, this.ctx.prisma, 2);
    const input = exact(this.ctx.request.body, ['name', 'content']);
    const name = text(input.name, 240);
    const content = text(input.content, 14_000_000);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) fail('COLLAB_INVALID_FILE');
    const bytes = Buffer.from(content, 'base64');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) fail('COLLAB_FILE_TOO_LARGE');
    const ext = path.extname(name).toLowerCase();
    const types: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    const mimeType = types[ext];
    if (!mimeType) fail('COLLAB_FILE_TYPE_UNSUPPORTED');
    const signatures: Record<string, boolean> = {
      '.png': bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      '.jpg': bytes[0] === 255 && bytes[1] === 216,
      '.jpeg': bytes[0] === 255 && bytes[1] === 216,
      '.pdf': bytes.subarray(0, 5).toString() === '%PDF-',
      '.webp': bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
      '.docx': bytes[0] === 80 && bytes[1] === 75,
      '.xlsx': bytes[0] === 80 && bytes[1] === 75,
    };
    if (!signatures[ext]) fail('COLLAB_FILE_SIGNATURE_INVALID');
    const id = randomUUID();
    const root = path.join(process.cwd(), 'var', 'storage', 'collaboration');
    await fs.mkdir(root, { recursive: true });
    const file = path.join(root, id);
    await fs.writeFile(file, bytes, { flag: 'wx' });
    try {
      const result = await this.ctx.prisma.collabAttachment.create({
        data: {
          id,
          tableId,
          ownerId: this.ctx.state.user.userId,
          name: path.basename(name),
          mimeType,
          size: bytes.length,
          storageKey: id,
        },
      });
      this.respond({ id: result.id, name: result.name, mimeType, size: bytes.length });
    } catch (error) {
      await fs.unlink(file);
      throw error;
    }
  }
  async download() {
    const { tableId, fileId } = this.ctx.params;
    const file = await this.collaborationService().attachment(tableId, fileId);
    if (this.ctx.query.metadata === 'true') {
      this.respond({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size });
      return;
    }
    this.ctx.set('Content-Type', file.mimeType);
    this.ctx.set('X-Content-Type-Options', 'nosniff');
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    this.ctx.body = await fs.readFile(
      path.join(process.cwd(), 'var', 'storage', 'collaboration', file.storageKey),
    );
    await this.ctx.prisma.operationLog.create({
      data: {
        userId: this.ctx.state.user.userId,
        action: 'file.download',
        targetType: 'COLLAB',
        targetId: file.id,
      },
    });
  }
}
