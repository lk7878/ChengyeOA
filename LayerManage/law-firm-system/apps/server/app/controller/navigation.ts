import { Controller } from 'egg';
import { NavigationMenuService } from '../application/collaboration/navigation-menu';
export default class NavigationController extends Controller {
  async index(){this.ctx.body={code:200,data:await new NavigationMenuService(this.ctx.prisma,this.ctx.state.authorization).read()};}
  async save(){this.ctx.body={code:200,data:await new NavigationMenuService(this.ctx.prisma,this.ctx.state.authorization).save(this.ctx.request.body)};}
}
