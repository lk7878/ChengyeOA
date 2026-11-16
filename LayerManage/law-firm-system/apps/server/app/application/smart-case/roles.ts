import { Prisma, PrismaClient } from '@prisma/client';

/** Only live OA memberships authorize subsystem capabilities. */
export async function smartCaseRoleIds(prisma:PrismaClient|Prisma.TransactionClient,userId:string,now=new Date()){
  const memberships=await prisma.userRole.findMany({where:{userId,revokedAt:null,validFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}],role:{status:'ENABLED'}},select:{roleId:true}});
  return memberships.map(row=>row.roleId);
}
