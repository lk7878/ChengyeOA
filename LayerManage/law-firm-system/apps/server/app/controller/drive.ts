import { Controller } from 'egg';
import { randomUUID } from 'node:crypto';
import { DriveService } from '../application/collaboration/drive-service';
import { AuthorizationContext } from '../application/authorization/authorization-service';

export default class DriveController extends Controller {
  private drive() {
    return new DriveService(this.ctx.prisma, this.ctx.state.authorization as AuthorizationContext);
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
    this.respond(await this.drive().list(this.ctx.params.workspaceId, this.ctx.query));
  }
  async folders() {
    this.respond(await this.drive().folders(this.ctx.params.workspaceId));
  }
  async createFolder() {
    this.respond(
      await this.drive().createFolder(this.ctx.params.workspaceId, this.ctx.request.body, this.key()),
    );
  }
  async createBase() {
    this.respond(
      await this.drive().createDriveBase(this.ctx.params.workspaceId, this.ctx.request.body, this.key()),
    );
  }
  async node() {
    this.respond(await this.drive().node(this.ctx.params.nodeId));
  }
  async rename() {
    this.respond(await this.drive().rename(this.ctx.params.nodeId, this.ctx.request.body, this.key()));
  }
  async previewLifecycle() {
    this.respond(await this.drive().previewLifecycle(this.ctx.params.nodeId, this.ctx.request.body));
  }
  async applyLifecycle() {
    this.respond(
      await this.drive().applyLifecycle(this.ctx.params.nodeId, this.ctx.request.body, this.key()),
    );
  }
  async access() {
    this.respond(await this.drive().folderAccess(this.ctx.params.folderId));
  }
  async saveAccess() {
    this.respond(
      await this.drive().saveFolderAccess(this.ctx.params.folderId, this.ctx.request.body, this.key()),
    );
  }
}
