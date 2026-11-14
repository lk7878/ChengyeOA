import { medicalOptions, medicalCustomer } from '../application/collaboration/medical-assessment';
import { WorksheetPermissions } from '../application/collaboration/worksheet-permissions';
import { isHrKind } from '../application/collaboration/hr-worksheets';
import { canReadHrPrivate } from '../application/collaboration/hr-privacy';
import { Controller } from 'egg';
import { validateOfficeZip } from '../domain/approval/approval-file-validation';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AuthorizationContext } from '../application/authorization/authorization-service';
import { createAuthorizationContextLoader } from '../application/authorization/authorization-factory';
import { createAuthenticationService } from '../application/auth/authentication-factory';
import { basePulse } from '../application/collaboration/base-pulse';
import { CollaborationService } from '../application/collaboration/collaboration-service';
import { RowComments } from '../application/collaboration/row-comments';
import { exact, fail, text } from '../application/collaboration/collaboration-policy';

export default class CollaborationController extends Controller {
  private worksheets() { return new WorksheetPermissions(this.ctx.prisma,this.ctx.state.authorization); }
  async policyCatalog() { this.respond(await this.worksheets().catalog()); }
  async policySettings() { this.respond(await this.worksheets().settings(this.ctx.params.tableId)); }
  async policySave() { this.respond(await this.worksheets().change(this.ctx.params.tableId,this.ctx.request.body,false)); }
  async policyInvite() { this.respond(await this.worksheets().change(this.ctx.params.tableId,this.ctx.request.body,true)); }
  async policyInvites() { this.respond(await this.worksheets().invitationOptions(this.ctx.params.tableId)); }
  async policyPreview() { this.respond(await this.worksheets().preview(this.ctx.params.tableId,this.ctx.request.body)); }
  async comments() { this.respond(await new RowComments(this.ctx.prisma, this.ctx.state.authorization).list(this.ctx.params.tableId, this.ctx.params.recordId, this.ctx.query.before)); }
  async commentPeople() { this.respond(await new RowComments(this.ctx.prisma, this.ctx.state.authorization).recipients(this.ctx.params.tableId, this.ctx.params.recordId, this.ctx.query.keyword || '')); }
  async saveComment() { this.respond(await new RowComments(this.ctx.prisma, this.ctx.state.authorization).save(this.ctx.params.tableId, this.ctx.params.recordId, this.ctx.params.commentId, this.ctx.request.body, this.key())); }
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
  async configureLifecycle() { this.respond(await this.collaborationService().configureLifecycle(this.ctx.params.tableId, this.ctx.request.body, this.key())); }
  async lifecycleChoices() { this.respond(await this.collaborationService().lifecycleChoices(this.ctx.params.tableId, this.ctx.query)); }
  async contractChoices() {
    this.respond(await this.collaborationService().contractChoices(this.ctx.query));
  }
  async medicalCustomers(){
    this.respond(await medicalOptions(this.ctx.prisma,this.ctx.state.authorization,this.ctx.params.tableId,String(this.ctx.query.keyword??'').slice(0,100)));
  }
  async medicalCustomer(){
    const {table,fields}=await this.collaborationService().tableAccess(this.ctx.params.tableId);
    if(table.followSupportKind!=='MEDICAL_ASSESSMENT')fail('COLLAB_INVALID_SOURCE');
    const source=await medicalCustomer(this.ctx.prisma,this.ctx.state.authorization,String(this.ctx.request.body.value));
    this.respond(Object.fromEntries(fields.filter(f=>f.options&&typeof f.options==='object'&&!Array.isArray(f.options)&&f.options.medicalAutofill).map(f=>[f.id,source[(f.options as {medicalAutofill:string}).medicalAutofill]])));
  }
  async moveTargets(){this.respond(await this.collaborationService().tableMoveTargets(this.ctx.params.tableId));}
  async previewMove(){this.respond(await this.collaborationService().previewTableMove(this.ctx.params.tableId,this.ctx.request.body));}
  async moveTable(){this.respond(await this.collaborationService().moveTable(this.ctx.params.tableId,this.ctx.request.body,this.key()));}
  async importRecords() { this.respond(await this.collaborationService().importRecords(this.ctx.params.tableId,this.ctx.request.body,this.key())); }
  async exportRecords() { this.respond(await this.collaborationService().exportRecords(this.ctx.params.tableId,this.ctx.request.body)); }
  async recordOperations() {
    this.respond(await this.collaborationService().recordOperations(this.ctx.params.tableId, this.ctx.query));
  }
  async reverseRecordOperation() {
    this.respond(
      await this.collaborationService().reverseRecordOperation(
        this.ctx.params.tableId,
        this.ctx.params.operationId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async deleteRecords() {
    this.respond(
      await this.collaborationService().deleteRecords(
        this.ctx.params.tableId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async businessRelationOptions() {
    this.respond(await this.collaborationService().businessRelationOptions(this.ctx.params.tableId, this.ctx.params.fieldId, this.ctx.request.body));
  }
  async index() {
    this.respond(await this.collaborationService().listWorkspaces(this.ctx.query));
  }
  async businessTables() {
    this.respond(await this.collaborationService().businessTables(this.ctx.query));
  }
  async saveBaseModule() {
    this.respond(await this.collaborationService().saveBaseModule(this.ctx.params.baseId, this.ctx.request.body, this.key()));
  }
  async createBusinessRecord() {
    this.respond(
      await this.collaborationService().createBusinessRecord(
        this.ctx.params.tableId,
        this.ctx.request.body,
        this.key(),
      ),
    );
  }
  async followLeadOptions() {
    this.respond(await this.collaborationService().followLeadOptions(this.ctx.params.tableId, this.ctx.query));
  }
  async provisionModuleWorkspace() {
    this.respond(await this.collaborationService().provisionModuleWorkspace(this.ctx.params.workspaceId, this.ctx.request.body, this.key()));
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
    this.respond(await this.collaborationService().options(this.ctx.query.workspaceId,this.ctx.query.tableId));
  }
  async members() {
    this.respond(await this.collaborationService().members(this.ctx.params.workspaceId));
  }
  async saveMember() {
    if (this.ctx.request.body?.tableGrants !== undefined) fail('WORKSHEET_USE_ROLE_CENTER',403);
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
    if (this.ctx.params.tableId) fail('WORKSHEET_USE_ROLE_CENTER',403);
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
  async reorderTables() {
    this.respond(
      await this.collaborationService().reorderTables(
        this.ctx.params.baseId,
        this.ctx.request.body,
        this.key(),
      ),
    );
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
    this.respond(
      await this.collaborationService().saveRecords(
        this.ctx.params.tableId,
        this.ctx.request.body,
        this.key(),
      ),
    );
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
    let presenceSnapshot = '';
    let heartbeatAt = 0;
    let pingAt = 0;
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
        if (!tableId) await current.baseAccess(baseId);
        if (tableId) {
          const selected = await current.tableAccess(tableId, ctx.prisma, 1, false, false);
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
        if (Date.now() - heartbeatAt >= 2000) {
          await ctx.prisma.collabPresence.upsert({
            where: { baseId_connectionId: { baseId, connectionId } },
            create: { baseId, connectionId, userId },
            update: { seenAt: new Date() },
          });
          heartbeatAt = Date.now();
        }
        const pulse = await basePulse(ctx.prisma, baseId);
        // Broadcast invalidations only; readers fetch their own authorized state.
        if (pulse.event && pulse.event.id > cursor) {
          const kind = pulse.accessId > cursor ? 'access.updated' : pulse.event.kind;
          cursor = pulse.event.id;
          emit('invalidate', { baseId, kind });
        }
        const presence = JSON.stringify(pulse.users);
        if (!closed && presence !== presenceSnapshot) {
          presenceSnapshot = presence;
          emit('presence', { users: pulse.users });
        }
        if (!closed && Date.now() - pingAt >= 15000) {
          stream.write(': heartbeat\n\n');
          pingAt = Date.now();
        }
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
    const uploadAccess=await this.collaborationService().tableAccess(tableId, this.ctx.prisma, 2);
    if(isHrKind(uploadAccess.table.inventoryKind)&&!canReadHrPrivate(this.ctx.state.authorization as AuthorizationContext)) fail('COLLAB_FORBIDDEN',403);
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
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
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
      '.pptx': bytes[0] === 80 && bytes[1] === 75,
      '.mp3': bytes.subarray(0,3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224),
      '.wav': bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WAVE',
      '.m4a': bytes.subarray(4,8).toString() === 'ftyp' && ['M4A ', 'M4B ', 'isom', 'mp42'].includes(bytes.subarray(8,12).toString()),
    };
    if (!signatures[ext]) fail('COLLAB_FILE_SIGNATURE_INVALID');
    if (ext === '.pptx') {
      try { validateOfficeZip(bytes, ext); }
      catch { fail('COLLAB_FILE_SIGNATURE_INVALID'); }
    }
    const id = randomUUID();
    const root = path.join(process.cwd(), 'var', 'storage', 'collaboration');
    await fs.mkdir(root, { recursive: true });
    const file = path.join(root, id);
    await fs.writeFile(file, bytes, { flag: 'wx' });
    try {
      const result = await this.ctx.prisma.$transaction(async tx => {
        const table = await tx.collabTable.findUnique({ where: { id: tableId }, select: { base: { select: { workspaceId: true } } } });
        if (!table) fail('COLLAB_NOT_FOUND', 404);
        await tx.$queryRaw`SELECT "id" FROM "collab_workspace" WHERE "id" = ${table.base.workspaceId} FOR SHARE`;
        const uploadAccess=await this.collaborationService().tableAccess(tableId, tx, 2);
        if(isHrKind(uploadAccess.table.inventoryKind)&&!canReadHrPrivate(this.ctx.state.authorization as AuthorizationContext)) fail('COLLAB_FORBIDDEN',403);
        return tx.collabAttachment.create({
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
