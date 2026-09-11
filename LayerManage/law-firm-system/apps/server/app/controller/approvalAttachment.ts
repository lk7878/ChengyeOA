import { Controller } from 'egg';
import { ApprovalAttachmentService } from '../application/approval/approval-attachment-service';
import { auditActor } from '../application/master-data/master-data-factory';
import { AuthorizationContext } from '../application/authorization/authorization-service';
import { APPROVAL_FILE_LIMIT, fileError } from '../domain/approval/approval-file-validation';

export default class ApprovalAttachmentController extends Controller {
  private attachmentService() { return new ApprovalAttachmentService(this.ctx.prisma, auditActor(this.ctx), this.ctx.state.authorization as AuthorizationContext); }
  private respond(data: unknown) { this.ctx.body = { code: 200, message: 'success', data }; }
  async upload() {
    const stream = await this.ctx.getFileStream();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > APPROVAL_FILE_LIMIT) { stream.destroy(); fileError('APPROVAL_FILE_TOO_LARGE', 413); }
      chunks.push(Buffer.from(chunk));
    }
    const sourceId = this.ctx.query.sourceId;
    if (sourceId && (typeof sourceId !== 'string' || sourceId.length > 100)) fileError();
    this.respond(await this.attachmentService().upload(stream.filename, Buffer.concat(chunks), sourceId));
  }
  async download() {
    const purpose = this.ctx.query.purpose;
    if (purpose && !['PREVIEW', 'DOWNLOAD'].includes(purpose)) fileError();
    this.respond(await this.attachmentService().download(this.ctx.params.id, purpose === 'PREVIEW' ? 'PREVIEW' : 'DOWNLOAD'));
  }
  async list() { this.respond(await this.attachmentService().list(this.ctx.params.id)); }
  async remove() { this.respond(await this.attachmentService().remove(this.ctx.params.id)); }
  async clone() { this.respond(await this.attachmentService().clone(this.ctx.params.id)); }
  async material() { this.respond(await this.attachmentService().exportRecord(this.ctx.params.id)); }
}
