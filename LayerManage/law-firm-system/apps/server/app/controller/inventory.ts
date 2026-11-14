import { MasterDataError } from '../domain/master-data/master-data-errors';
import { Controller } from 'egg';
import { InventoryService } from '../application/inventory/inventory-service';
import { AuthorizationContext } from '../application/authorization/authorization-service';
import { auditActor } from '../application/master-data/master-data-factory';
import { assertExactKeys } from '../domain/master-data/master-data-validation';
export default class InventoryController extends Controller {
  private inventory() {
    return new InventoryService(
      this.ctx.prisma,
      auditActor(this.ctx),
      this.ctx.state.authorization as AuthorizationContext,
    );
  }
  private respond(data: unknown) {
    this.ctx.body = { code: 200, message: 'success', data };
  }
  async index() {
    this.respond(await this.inventory().list(this.ctx.query));
  }
  async save() {
    this.respond(await this.inventory().saveItem(this.ctx.request.body, this.ctx.params.id));
  }
  async move() {
    this.respond(await this.inventory().move(this.ctx.request.body));
  }
  async stocktake() {
    this.respond(await this.inventory().stocktake(this.ctx.request.body));
  }
  async showItem() {
    this.respond(await this.inventory().get(this.ctx.params.id, 'items'));
  }
  async showMovement() {
    this.respond(await this.inventory().get(this.ctx.params.id, 'movements'));
  }
  async showStocktake() {
    this.respond(await this.inventory().get(this.ctx.params.id, 'stocktakes'));
  }
  async recipients() {
    assertExactKeys(this.ctx.query, ['keyword', 'page']);
    const value = this.ctx.query.page;
    if (value !== undefined && !/^[1-9]\d*$/.test(value)) throw new MasterDataError('VALIDATION_FAILED', 400);
    this.respond(
      await this.inventory().recipients(
        this.ctx.query.keyword,
        value === undefined ? undefined : Number(value),
      ),
    );
  }
  async export() {
    this.respond(await this.inventory().export(this.ctx.query));
  }
}
