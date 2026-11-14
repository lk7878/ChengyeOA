import { PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { exact, fail, integer, text } from './collaboration-policy';
export const menuTargets=['/leads','/leads/follows','/leads/pool','/customers','/channels','/negotiations','/contracts','/cases','/payments','/invoices','/refunds','/costs','/inventory/items','/inventory/movements','/inventory/stocktakes','/performances'];
export type MenuNode={id:string;label:string;parentId:string|null;target:string|null;position:number};
export class NavigationMenuService {
  constructor(private db:PrismaClient,private actor:AuthorizationContext){}
  async read(){const row=await this.db.navigationMenu.findUnique({where:{id:'business'}});return {version:row?.version??0,nodes:row?.nodes??null,targets:menuTargets};}
  async save(raw:unknown){
    if(!this.actor.isSystemSuperAdmin)fail('COLLAB_FORBIDDEN',403);
    const input=exact(raw,['version','nodes']);
    if(!Array.isArray(input.nodes)||input.nodes.length>200)fail('COLLAB_INVALID_NAVIGATION');
    const nodes:MenuNode[]=input.nodes.map(raw=>{const n=exact(raw,['id','label','parentId','target','position']);
      const target=n.target===null?null:text(n.target,100);if(target&&!menuTargets.includes(target))fail('COLLAB_INVALID_NAVIGATION');
      return {id:text(n.id,100),label:text(n.label,50),parentId:n.parentId===null?null:text(n.parentId,100),target,position:integer(n.position,0,1000)};});
    const byId=new Map(nodes.map(n=>[n.id,n]));if(byId.size!==nodes.length)fail('COLLAB_INVALID_NAVIGATION');
    for(const node of nodes){let parent=node.parentId;const seen=new Set([node.id]);while(parent){const p=byId.get(parent);if(!p||p.target||seen.has(parent)||seen.size>6)fail('COLLAB_INVALID_NAVIGATION');seen.add(parent);parent=p.parentId;}}
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('navigation-menu',0))`;
      const old=await tx.navigationMenu.findUnique({where:{id:'business'}});
      if(integer(input.version,0)!==(old?.version??0))fail('COLLAB_ACCESS_CONFLICT',409);
      const row=await tx.navigationMenu.upsert({where:{id:'business'},create:{id:'business',version:1,nodes},update:{version:{increment:1},nodes}});
      await tx.operationLog.create({data:{userId:this.actor.userId,action:'NAVIGATION_MENU_UPDATE',targetType:'NAVIGATION',targetId:'business',oldValues:JSON.stringify(old?.nodes??null),newValues:JSON.stringify(nodes)}});
      return {version:row.version,nodes:row.nodes,targets:menuTargets};
    });
  }
}
