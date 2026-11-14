import { Controller } from 'egg';
import { PersonalFiles } from '../application/collaboration/personal-files';
export default class PersonalFileController extends Controller {
  private svc(){return new PersonalFiles(this.ctx.prisma,this.ctx.state.authorization);}
  private respond(data:unknown){this.ctx.body={code:200,data};}
  async index(){this.respond(await this.svc().list(this.ctx.query));}
  async create(){this.respond(await this.svc().create(this.ctx.request.body));}
  async replace(){this.respond(await this.svc().replace(this.ctx.params.id,this.ctx.request.body));}
  async download(){this.respond(await this.svc().download(this.ctx.params.id));}
  async access(){this.respond(await this.svc().accessSettings(this.ctx.params.id));}
  async share(){this.respond(await this.svc().share(this.ctx.params.id,this.ctx.request.body));}
  async rename(){this.respond(await this.svc().rename(this.ctx.params.id,this.ctx.request.body));}
  async people(){this.respond(await this.svc().people(String(this.ctx.query.keyword??'')));}
}
