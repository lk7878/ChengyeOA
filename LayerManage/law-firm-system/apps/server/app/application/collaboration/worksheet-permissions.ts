import { Prisma, PrismaClient } from '@prisma/client';
import type { AuthorizationContext } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { CollaborationService } from './collaboration-service';
import { choice, exact, fail, integer, text } from './collaboration-policy';
import { parseRule, presets, type RolePolicy } from './worksheet-roles';
import { appendCollaborationChange } from './collaboration-change';

export class WorksheetPermissions {
  constructor(readonly db: PrismaClient, readonly actor: AuthorizationContext) {}
  private manage() {
    if (!this.actor.isSystemSuperAdmin && !this.actor.permissionCodes.includes('role.permission.manage')) fail('COLLAB_FORBIDDEN',403);
  }
  private async requireTableAdmin(tableId:string, tx:Prisma.TransactionClient=this.db) {
    if (this.actor.isSystemSuperAdmin) return;
    const {access} = await new CollaborationService(this.db,this.actor).tableAccess(tableId,tx,3);
    if (!access.canManageAccess) fail('COLLAB_FORBIDDEN',403);
  }
  async catalog() {
    this.manage();
    const tables = await this.db.collabTable.findMany({ where: { archived:false, base:{ OR:[{driveNode:null},{driveNode:{is:{deletedAt:null}}}] } },
      select:{id:true,name:true,base:{select:{id:true,name:true,workspace:{select:{name:true}}}}}, orderBy:[{name:'asc'},{id:'asc'}] });
    if (this.actor.isSystemSuperAdmin) return tables;
    const allowed: typeof tables = [];
    for (const t of tables) {
      try { await this.requireTableAdmin(t.id); allowed.push(t); }
      catch(e) { if (![403,404].includes((e as {status:number}).status)) throw e; }
    }
    return allowed;
  }
  async settings(tableId: string) {
    this.manage();
    await this.requireTableAdmin(tableId);
    const table = await this.db.collabTable.findFirst({where:{id:tableId,archived:false}, select:{
      views:{where:{shared:true},orderBy:{position:'asc'},select:{id:true,name:true}},fields:{where:{archived:false},orderBy:{position:'asc'}},rolePolicy:true }});
    if (!table) fail('COLLAB_NOT_FOUND',404);
    return { views:table.views,fields:table.fields,rules:table.rolePolicy?.rules ?? {},version:table.rolePolicy?.version ?? 0 };
  }
  async change(tableId: string, raw: unknown, invite: boolean) {
    const input = exact(raw,invite ? ['roleId','userId','version'] : ['roleId','rule','version']);
    const roleId = text(input.roleId);
    if (!invite) this.manage();
    return this.db.$transaction(async tx => {
      const base = await tx.collabTable.findFirst({where:{id:tableId,archived:false},select:{baseId:true,base:{select:{workspaceId:true}}}});
      if (!base) fail('COLLAB_NOT_FOUND',404);
      await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${base.base.workspaceId} FOR UPDATE`;
      if (!invite) await this.requireTableAdmin(tableId,tx);
      const row = await tx.collabTable.findUniqueOrThrow({where:{id:tableId},include:{rolePolicy:true,views:{where:{shared:true},select:{id:true}},fields:{where:{archived:false}}}});
      const version = row.rolePolicy?.version ?? 0;
      if (integer(input.version,0) !== version) fail('COLLAB_ACCESS_CONFLICT',409);
      const rules = {...(row.rolePolicy?.rules || {}) as unknown as RolePolicy['rules']};
      const invitations = {...(row.rolePolicy?.invitations || {}) as RolePolicy['invitations']};
      if (!(invite && roleId === 'REMOVE') && !presets.some(p => p === roleId) && !await tx.role.findFirst({where:{id:roleId,status:'ENABLED',type:'BUSINESS'}}))
        fail('COLLAB_INVALID_ACCESS');
      if (roleId === 'OWNER') fail('COLLAB_OWNER_IMMUTABLE',403);
      if (invite) {
        const svc = new CollaborationService(this.db,this.actor);
        const selected = await svc.tableAccess(tableId,tx,3);
        if (!selected.access.canManageAccess) fail('COLLAB_FORBIDDEN',403);
        const userId = text(input.userId);
        if (roleId === 'REMOVE') delete invitations[userId];
        else {
          if (!(await svc.options(base.base.workspaceId,tableId)).users.some(u => u.id === userId)) fail('COLLAB_MEMBER_UNAVAILABLE');
          if (!presets.some(p => p === roleId) && !rules[roleId]) fail('COLLAB_INVALID_ACCESS');
          invitations[userId]=roleId;
        }
      } else rules[roleId]=parseRule(input.rule,row.fields,row.views.map(v=>v.id));
      const data={rules:rules as unknown as Prisma.InputJsonValue,invitations,version:version+1};
      await tx.worksheetRolePolicy.upsert({where:{tableId},create:{tableId,...data},update:data});
      await tx.operationLog.create({data:{userId:this.actor.userId,targetType:'COLLAB_TABLE',targetId:tableId,
        action:invite?'WORKSHEET_ROLE_INVITE':'WORKSHEET_ROLE_POLICY',newValues:JSON.stringify(input)}});
      await appendCollaborationChange(tx,this.actor.userId,base.baseId,'access.updated',tableId);
      return {version:version+1};
    });
  }
  async invitationOptions(tableId: string) {
    const svc=new CollaborationService(this.db,this.actor);
    const {access}=await svc.tableAccess(tableId,this.db,3);
    if (!access.canManageAccess) fail('COLLAB_FORBIDDEN',403);
    const saved=await this.db.worksheetRolePolicy.findUnique({where:{tableId}});
    const ids=Object.keys(saved?.rules || {});
    const roles=await this.db.role.findMany({where:{id:{in:ids},status:'ENABLED',type:'BUSINESS'},select:{id:true,name:true}});
    return { roles,invitations:saved?.invitations ?? {},version:saved?.version ?? 0 };
  }
  async preview(tableId: string, raw: unknown) {
    if (!this.actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN',403);
    const input=exact(raw,['target','id','page','viewId']);
    const target=choice(input.target,['MEMBER','ROLE','PRESET']), id=text(input.id);
    const loader=new AuthorizationContextLoader(this.db);
    const actor = target==='MEMBER' ? await loader.load(id) : target==='ROLE' ? await loader.previewRole(id) :
      {...this.actor,userId:'preview:preset',employeeId:null,isSystemSuperAdmin:false};
    if (target==='PRESET' && !presets.some(p=>p===id)) fail('COLLAB_INVALID_ACCESS');
    const svc=new CollaborationService(this.db,actor,target==='PRESET'?{tableId,preset:choice(id,[...presets]) as typeof presets[number],viewer:this.actor}:target==='ROLE'?{roleId:id}:undefined);
    try {
      return await this.readPreview(svc,tableId,input,actor);
    } catch (error) {
      const code=(error as {code?:string}).code;
      if (code && ['COLLAB_FORBIDDEN','PERMISSION_DENIED','DATA_SCOPE_DENIED','SPECIAL_PERMISSION_REQUIRED'].includes(code))
        fail('WORKSHEET_PREVIEW_TARGET_DENIED',403);
      throw error;
    }
  }
  private async readPreview(svc:CollaborationService,tableId:string,input:Record<string,unknown>,actor:AuthorizationContext) {
    const detail=await svc.describe(tableId);
    const view = detail.views.find(v=>v.id===input.viewId) ?? detail.views.find(v=>v.isDefault) ?? detail.views[0];
    const data=await svc.query(tableId,{page:integer(input.page ?? 1),pageSize:25,viewId:view?.id});
    const selected=view?.config.visibleFields;
    return {fields: selected?.length ? selected.flatMap(k=> detail.fields.filter(f=>f.id===k)) : detail.fields,
      records:data.records,total:data.total,source:detail.table.source,actions:detail.access.level>=2 && detail.access.add!==false ? actor.permissionCodes : [],canEdit:detail.access.level>=2 && detail.fields.some(f=>f.writable),canAdd:detail.access.add!==false && detail.access.level>=2 && (detail.table.source==='CUSTOM' || detail.canCreateBusiness),
      canDelete:detail.canDeleteRecords };
  }
}
