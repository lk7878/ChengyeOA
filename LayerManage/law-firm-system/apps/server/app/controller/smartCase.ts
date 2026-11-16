import { smartCaseRoleIds } from '../application/smart-case/roles';
import { SmartCaseArchive } from '../application/smart-case/archive';
import { Controller } from 'egg';
import { SmartCaseIdentity } from '../application/smart-case/identity';
import { buildCaseScopeWhere, requireCaseAccess } from '../application/case/case-scope';
export default class SmartCaseController extends Controller {
  private identity(){return new SmartCaseIdentity(this.ctx.prisma);}
  private respond(data:unknown){this.ctx.set('Cache-Control','no-store');this.ctx.body={code:200,data};}
  async entryConfig(){this.respond({url:process.env.SMART_CASE_PUBLIC_URL?new URL('/api/auth/start',process.env.SMART_CASE_PUBLIC_URL).href:null});}
  async launch(){this.respond(await this.identity().issue(this.ctx.state.user,this.ctx.state.authorization,String(this.ctx.request.body?.challenge||'')));}
  async exchange(){this.respond(await this.identity().exchange(String(this.ctx.request.body?.code||''),this.ctx.get('x-smart-case-client'),String(this.ctx.request.body?.verifier||'')));}
  async me(){
    const user=await this.ctx.prisma.user.findUniqueOrThrow({where:{id:this.ctx.state.user.userId},select:{id:true,username:true,appearance:true,employee:{select:{name:true}}}});
    const a=this.ctx.state.authorization;
    const roleIds=await smartCaseRoleIds(this.ctx.prisma,user.id);
    this.respond({appearance:user.appearance,id:user.id,username:user.username,displayName:user.employee?.name||user.username,isSystemSuperAdmin:a.isSystemSuperAdmin,permissions:a.permissionCodes,roleIds});
  }
  async roles(){if(!this.ctx.state.authorization.isSystemSuperAdmin)this.ctx.throw(403);this.respond(await this.ctx.prisma.role.findMany({where:{status:'ENABLED'},select:{id:true,code:true,name:true,type:true},orderBy:{name:'asc'}}));}
  async logout(){await this.identity().revoke(this.ctx.get('authorization').slice(7));this.respond({ok:true});}
  async directory(){if(!this.ctx.state.authorization.isSystemSuperAdmin)this.ctx.throw(403);this.respond(await this.ctx.prisma.user.findMany({where:{status:'ENABLED'},select:{id:true,username:true,employee:{select:{name:true}}}}));}
  async cases(){const where=await buildCaseScopeWhere(this.ctx.prisma,this.ctx.state.authorization,'case.read');this.respond(await this.ctx.prisma.case.findMany({where,select:{id:true,caseNo:true,title:true,status:true,lawyer:{select:{id:true,name:true}}}}));}
  async archive(){this.respond(await new SmartCaseArchive(this.ctx.prisma,this.ctx.state.authorization).archive(this.ctx.request.body));}
  async caseDetail(){const row=await requireCaseAccess(this.ctx.prisma,this.ctx.state.authorization,this.ctx.params.id,'case.read');const lawyer=row.lawyerId?await this.ctx.prisma.employee.findUnique({where:{id:row.lawyerId},select:{id:true,name:true}}):null;this.respond({id:row.id,caseNo:row.caseNo,title:row.title,status:row.status,lawyer});}
}
