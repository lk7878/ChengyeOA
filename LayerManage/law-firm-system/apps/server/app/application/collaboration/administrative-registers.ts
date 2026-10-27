import { CollabField, CollabTable, Prisma } from '@prisma/client';
import { fail, object } from './collaboration-policy';

export const administrativeKinds = ['ADMIN_SEAL', 'ADMIN_SENT', 'ADMIN_RECEIVED', 'ADMIN_MEETINGS'] as const;
export type AdministrativeKind = typeof administrativeKinds[number];
export const isAdministrativeKind = (kind: string) => kind === 'ADMIN_EXPENSES' || administrativeKinds.includes(kind as AdministrativeKind);
export const administrativeNames: Record<AdministrativeKind, string> = {
  ADMIN_SEAL: '用印登记', ADMIN_SENT: '发文登记', ADMIN_RECEIVED: '收文登记', ADMIN_MEETINGS: '会议登记',
};
type Spec = [name: string, type: string, required?: boolean];
const definitions: Record<AdministrativeKind, Spec[]> = {
  ADMIN_SEAL: [['序号','AUTONUMBER'],['申请时间','DATETIME'],['申请人','TEXT',true],['申请事项','LONG_TEXT'],['申请附件','FILE'],['审核意见','LONG_TEXT']],
  // Preserve the names and incoming/outgoing field mapping explicitly supplied in the acceptance document.
  ADMIN_SENT: [['序号','AUTONUMBER'],['收文日期','DATETIME',true],['来文单位','TEXT',true],['来文字号','TEXT'],['文件标题','LONG_TEXT',true],['密级','SINGLE_SELECT'],['紧急程度','SINGLE_SELECT'],['收文份数','NUMBER'],['上传附件','FILE'],['收文人','TEXT',true],['处理意见','LONG_TEXT'],['承办部门/人','TEXT'],['办理时限','DATETIME'],['办理结果/状态','SINGLE_SELECT'],['备注','LONG_TEXT']],
  ADMIN_RECEIVED: [['序号','AUTONUMBER'],['发文日期','DATETIME',true],['发文字号','TEXT'],['文件标题','LONG_TEXT',true],['密级','SINGLE_SELECT'],['紧急程度','SINGLE_SELECT'],['主送单位','TEXT',true],['抄送单位','TEXT'],['印发份数','NUMBER',true],['附件清单','LONG_TEXT'],['上传附件','FILE'],['签发人','TEXT'],['承办部门/人','TEXT'],['发文方式','SINGLE_SELECT'],['签收人/回执情况','LONG_TEXT'],['归档份数/位置','TEXT'],['备注','LONG_TEXT']],
  ADMIN_MEETINGS: [['序号','AUTONUMBER'],['会议编号','TEXT'],['会议名称','TEXT',true],['会议类型','SINGLE_SELECT'],['会议时间','DATETIME',true],['会议地点','TEXT',true],['主办部门','TEXT'],['主持人','TEXT',true],['记录人','TEXT',true],['应到人数','NUMBER'],['实到人数','NUMBER'],['完成状态','SINGLE_SELECT'],['会议所有资料','FILE'],['签到表','FILE'],['备注','LONG_TEXT']],
};
const choices: Record<string, string[]> = {
  密级: ['绝密','机密','秘密','普通'], 紧急程度: ['特急','加急','普通'],
  '办理结果/状态': ['待处理','办理中','已办结','已归档'], 会议类型: ['例会','专题会','培训会','股东大会','其他'],
  完成状态: ['未开始','进行中','已结束','已取消'], 发文方式: ['当面送达','快递','电子送达'],
};
const colors: Record<string,string> = {绝密:'red',机密:'volcano',秘密:'orange',普通:'default',特急:'red',加急:'orange',待处理:'gold',办理中:'blue',已办结:'green',已归档:'default',未开始:'gold',进行中:'blue',已结束:'green',已取消:'default'};
export function administrativeFields(kind: AdministrativeKind) {
  return definitions[kind].map(([name,type,required=false],position) => ({
    name,type,required,position,
    defaultValue: (name === '收文份数' ? 1 : ['密级','紧急程度'].includes(name) ? '普通' : name === '办理结果/状态' ? '待处理' : name === '完成状态' ? '未开始' : Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    options: {
      inventoryKey:name, ...(position === 0 ? {primary:true}:{}),
      ...(['收文日期','发文日期','办理时限'].includes(name)?{dateOnly:true}:{}),
      ...(['申请时间','会议时间'].includes(name)?{dateMinute:true}:{}),
      ...(['申请时间','收文日期','发文日期'].includes(name)?{defaultNow:true}:{}),
      ...(type === 'NUMBER'?{nonnegativeInteger:true}:{}),
      ...(name==='会议编号'?{helpText:'同一会议登记表内不可重复；留空时不校验。'}:{}),
      ...(name==='审核意见'?{adminReview:true,helpText:'仅获授“用印审核”权限且有表格编辑权限的人员可填写审核结果和原因。'}:{}),
      ...(choices[name]?{choices:choices[name].map(value=>({id:value,name:value,...(colors[value]?{color:colors[value]}:{})}))}:{}),
    } as Prisma.InputJsonObject,
  }));
}

/** Serialize the unique-number check on edits and restores as well as inserts. */
export async function validateAdministrativeRecord(tx: Prisma.TransactionClient, table: CollabTable, fields: CollabField[], values: Record<string,unknown>, recordId?:string) {
  if(table.inventoryKind!=='ADMIN_MEETINGS') return;
  await tx.$queryRaw`SELECT id FROM collab_table WHERE id=${table.id} FOR UPDATE`;
  const field=fields.find(f=>!f.archived&&object(f.options).inventoryKey==='会议编号');
  if(!field) return;
  const number=values[field.id];
  if(number===undefined||number===null||number==='') return;
  if(await tx.collabRecord.findFirst({where:{tableId:table.id,archived:false,...(recordId?{id:{not:recordId}}:{}),values:{path:[field.id],equals:String(number)}},select:{id:true}}))
    fail('COLLAB_MEETING_NUMBER_DUPLICATE',409,{fieldId:field.id});
}
