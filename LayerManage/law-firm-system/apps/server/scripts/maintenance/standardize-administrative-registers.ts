import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import { administrativeFields, administrativeKinds, administrativeNames } from '../../app/application/collaboration/administrative-registers';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';

/** Offline conversion of the four empty registration templates; never discard existing business records. */
export async function standardizeAdministrativeRegisters(db: PrismaClient, actorId: string, apply=false) {
  const report=[];
  const bases=await db.collabBase.findMany({where:{moduleSource:'INVENTORY_MOVEMENTS',workspace:{moduleGroup:'ADMINISTRATION'},OR:[{driveNode:null},{driveNode:{deletedAt:null}}]}});
  for(const base of bases) for(const kind of administrativeKinds) {
    const tables=await db.collabTable.findMany({where:{baseId:base.id,archived:false,OR:[{inventoryKind:kind},{name:administrativeNames[kind]}]},include:{fields:true}});
    for(const table of tables) {
      const specs=administrativeFields(kind);
      const changed=table.inventoryKind!==kind||table.source!=='CUSTOM'||table.fields.filter(f=>!f.archived).length!==specs.length||specs.some(s=>!table.fields.some(f=>!f.archived&&f.name===s.name&&f.type===s.type&&f.required===s.required&&f.position===s.position&&isDeepStrictEqual(f.options,s.options)&&isDeepStrictEqual(f.defaultValue,s.defaultValue===Prisma.DbNull?null:s.defaultValue)));
      report.push({tableId:table.id,name:table.name,fields:specs.map(s=>s.name),changed});
      if(!apply||!changed) continue;
      await db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${base.workspaceId} FOR UPDATE`;
        const current=await tx.collabTable.findUniqueOrThrow({where:{id:table.id},include:{base:{include:{workspace:true,driveNode:true}}}});
        if(current.schemaVersion!==table.schemaVersion||current.archived||current.baseId!==base.id||current.base.workspaceId!==base.workspaceId||current.base.workspace.moduleGroup!=='ADMINISTRATION'||current.base.moduleSource!=='INVENTORY_MOVEMENTS'||current.base.driveNode?.deletedAt)
          throw new Error('工作区或字段已发生变化，请重新核对后迁移');
        if(table.inventoryKind!==kind&&(await tx.collabRecord.count({where:{tableId:table.id}})||await tx.collabExtension.count({where:{tableId:table.id}})))
          throw new Error('原表已有记录，需核对字段映射后迁移；未删除任何数据');
        const ids=[];
        for(const spec of specs) {
          const previous=table.fields.find(f=>f.name===spec.name);
          const field=previous?await tx.collabField.update({where:{id:previous.id},data:{...spec,archived:false}}):await tx.collabField.create({data:{...spec,tableId:table.id}});
          ids.push(field.id);
        }
        await tx.collabField.updateMany({where:{tableId:table.id,id:{notIn:ids}},data:{archived:true}});
        await tx.collabTable.update({where:{id:table.id},data:{source:'CUSTOM',inventoryKind:kind,schemaVersion:{increment:1}}});
        await tx.collabView.updateMany({where:{tableId:table.id},data:{config:{visibleFields:ids},version:{increment:1}}});
        if(!await tx.collabView.count({where:{tableId:table.id}})) await tx.collabView.create({data:{tableId:table.id,name:'总表',ownerId:actorId,shared:true,isDefault:true,config:{visibleFields:ids}}});
        await tx.operationLog.create({data:{userId:actorId,action:'ADMIN_REGISTER_STANDARDIZE',targetType:'COLLAB_TABLE',targetId:table.id,oldValues:JSON.stringify(table),newValues:JSON.stringify({kind,fields:ids})}});
        await appendCollaborationChange(tx,actorId,base.id,'table.updated',table.id);
      },{timeout:60000});
    }
  }
  return report;
}
if(require.main===module) {
  const db=new PrismaClient();
  db.user.findUniqueOrThrow({where:{username:'admin'}}).then(u=>standardizeAdministrativeRegisters(db,u.id,process.argv.includes('--apply')))
    .then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
}
