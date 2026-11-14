import { PrismaClient, Prisma } from '@prisma/client';
import { PERMISSION_CATALOG } from '../../domain/authorization/permission-catalog';
import { authorizationInputError } from '../../domain/authorization/authorization-errors';
import { fail, exact, integer } from '../collaboration/collaboration-policy';

export const basicOfficeCodes = ['approval.read', 'approval.apply', 'approval.process', 'menu.security_my_access', 'permission.trace.self'];
type DB = PrismaClient | Prisma.TransactionClient;
export async function officeTemplate(db: DB) {
  const row = await db.officeRoleTemplate.findUnique({ where: { id: 'basic' } });
  return { version: row?.version ?? 1, permissionCodes: (row?.permissionCodes ?? basicOfficeCodes) as string[],
    capabilities: [
      '工作台及本人通知', '本人日程管理、公开和受邀日程查看', '发起开放申请、查看本人相关审批、处理分配给本人的审批任务',
      '查看已获授权的云盘及多维表格、搜索筛选和个人视图', '个人资料、账号安全及本人权限查询',
    ] };
}
export async function saveOfficeTemplate(db: PrismaClient, userId: string, raw: unknown) {
  const input = exact(raw, ['version','permissionCodes']);
  if (!Array.isArray(input.permissionCodes) || input.permissionCodes.some(c=>typeof c !== 'string' || !basicOfficeCodes.includes(c))) authorizationInputError();
  const codes = [...new Set(input.permissionCodes as string[])];
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('office-role-template',0))`;
    const old = await officeTemplate(tx);
    if (integer(input.version) !== old.version) fail('COLLAB_ACCESS_CONFLICT',409);
    await tx.officeRoleTemplate.upsert({where:{id:'basic'},create:{id:'basic',permissionCodes:codes,version:old.version+1},
      update:{permissionCodes:codes,version:old.version+1}});
    await tx.operationLog.create({data:{userId,action:'OFFICE_TEMPLATE_UPDATE',targetType:'ROLE_TEMPLATE',targetId:'basic',
      oldValues:JSON.stringify(old),newValues:JSON.stringify({permissionCodes:codes,version:old.version+1})}});
    return officeTemplate(tx);
  });
}
export async function applyOfficeTemplate(db: PrismaClient, userId: string, raw: unknown) {
  const input=exact(raw,['roles','templateVersion','apply']);
  if (!Array.isArray(input.roles) || !input.roles.length || input.roles.length>100 || typeof input.apply!=='boolean') authorizationInputError();
  const roles=input.roles.map(item=>{const v=exact(item,['id','version']); if(typeof v.id!=='string') authorizationInputError(); return {id:v.id,version:integer(v.version)};});
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('office-role-template',0))`;
    const template=await officeTemplate(tx);
    if(integer(input.templateVersion)!==template.version) fail('COLLAB_ACCESS_CONFLICT',409);
    const result=[];
    for(const selected of roles.sort((a,b)=>a.id.localeCompare(b.id))) {
      await tx.$queryRaw`SELECT id FROM role WHERE id=${selected.id} FOR UPDATE`;
      const role=await tx.role.findFirst({where:{id:selected.id,type:'BUSINESS',status:{not:'DELETED'}},include:{permissions:{include:{permission:true}}}});
      if(!role || role.version!==selected.version) fail('COLLAB_ACCESS_CONFLICT',409);
      const current=role.permissions.map(p=>p.permission.code);
      const old=(role.officeTemplateSnapshot as {permissionCodes?:string[]}|null)?.permissionCodes ?? [];
      const added=template.permissionCodes.filter(c=>!current.includes(c));
      const removed=old.filter(c=>!template.permissionCodes.includes(c)&&current.includes(c));
      result.push({id:role.id,name:role.name,added:added.map(c=>PERMISSION_CATALOG.find(p=>p.code===c)?.name||c),
        removed:removed.map(c=>PERMISSION_CATALOG.find(p=>p.code===c)?.name||c)});
      if(input.apply) {
        await tx.rolePermission.deleteMany({where:{roleId:role.id,permission:{code:{in:removed}}}});
        await tx.rolePermission.createMany({data:added.map(code=>({roleId:role.id,permissionId:'permission:'+code})),skipDuplicates:true});
        await tx.role.update({where:{id:role.id},data:{officeTemplateSnapshot:template,version:{increment:1}}});
        await tx.operationLog.create({data:{userId,action:'OFFICE_TEMPLATE_APPLY',targetType:'ROLE_AUTHORIZATION',targetId:role.id,
          newValues:JSON.stringify({templateVersion:template.version,added,removed})}});
      }
    }
    return result;
  });
}
