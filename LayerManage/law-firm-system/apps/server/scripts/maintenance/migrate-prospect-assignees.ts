import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {AuthorizationContextLoader} from '../../app/application/authorization/authorization-context-loader';
import {migrateProspectAssignments} from '../../app/application/collaboration/prospect-assignment-migration';

// Usage: tsx scripts/maintenance/migrate-prospect-assignees.ts plan.json [--apply]
// plan: {actorUsername: string, targets: [{tableId: string, organizationId: string}]}
async function main(){
 const plan=JSON.parse(await readFile(process.argv[2],'utf8')) as {actorUsername:string;targets:{tableId:string;organizationId:string}[]};
 if(!plan.actorUsername||!Array.isArray(plan.targets)||!plan.targets.length)throw new Error('请提供管理员账号及明确的数据表、分配组织对应清单');
 const db=new PrismaClient();
 try{
  const user=await db.user.findUniqueOrThrow({where:{username:plan.actorUsername},select:{id:true}});
  const actor=await new AuthorizationContextLoader(db).load(user.id);
  console.log(JSON.stringify(await migrateProspectAssignments(db,actor,plan.targets,process.argv.includes('--apply')),null,2));
 }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e.code || e.message);process.exitCode=1;});
