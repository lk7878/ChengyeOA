import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { AuthorizationContext } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { writeAuthorizationAudit } from '../authorization/authorization-audit';
import { fail } from '../collaboration/collaboration-policy';

/** Establish only the global half of review eligibility. A target library ACL is still mandatory. */
export async function ensureKnowledgeReviewers(db:PrismaClient, actor:AuthorizationContext, ids:unknown) {
  if (!actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN',403);
  if (!Array.isArray(ids) || ids.length>1000 || ids.some(id=>typeof id!=='string')) fail('COLLAB_INVALID_ACCESS');
  const userIds=[...new Set(ids as string[])].sort();
  return db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(718243019)`;
    const users=await tx.user.findMany({where:{id:{in:userIds},status:'ENABLED'},select:{id:true}});
    if(users.length!==userIds.length)fail('COLLAB_MEMBER_UNAVAILABLE');
    let role=await tx.role.findFirst({where:{status:'ENABLED',type:'BUSINESS',code:{startsWith:'KNOWLEDGE_ACL_REVIEW_'},permissions:{every:{permission:{code:'knowledge.review'}},some:{permission:{code:'knowledge.review'}}}}});
    const added:string[]=[];
    for(const id of userIds) {
      await tx.$queryRaw`SELECT id FROM "user" WHERE id=${id} FOR UPDATE`;
      const context=await new AuthorizationContextLoader(tx).load(id);
      if(context.permissionCodes.includes('knowledge.review'))continue;
      if(!role){const suffix=randomUUID().slice(0,8).toUpperCase();role=await tx.role.create({data:{code:'KNOWLEDGE_ACL_REVIEW_'+suffix,name:'知识库维护审核资格 · '+suffix,type:'BUSINESS',status:'ENABLED',permissions:{create:{permissionId:'permission:knowledge.review'}}}});}
      await tx.userRole.create({data:{userId:id,roleId:role.id,source:'PERMANENT',reason:'知识库管理员配置审核权限时联动建立；逐库 ACL 仍独立校验',grantedByUserId:actor.userId}});
      added.push(id);
    }
    if(added.length)await writeAuthorizationAudit(tx,{actorUserId:actor.userId,action:'ENSURE_KNOWLEDGE_REVIEW_ELIGIBILITY',targetType:'ROLE_AUTHORIZATION',targetId:role!.id,changes:{userIds:added,permissionCodes:['knowledge.review']}});
    return {ok:true,added:added.length};
  });
}
