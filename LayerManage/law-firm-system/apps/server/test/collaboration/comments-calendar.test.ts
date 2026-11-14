import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { RowComments } from '../../app/application/collaboration/row-comments';
import { CalendarService, deliverCalendarReminders } from '../../app/application/calendar/calendar-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
let db: PrismaClient, owner: AuthorizationContext, reader: AuthorizationContext, outsider: AuthorizationContext;
let workspace: string, base: string, table: string, record: string, org: string;
const context = (id: string, admin = false): AuthorizationContext => ({ userId:id, employeeId:null,
  isSystemSuperAdmin:admin, isSystemAdmin:false, evaluatedAt:new Date(), fieldRules:[],
  permissionCodes:admin?PERMISSION_CATALOG.map(p=>p.code):[],
  grants:admin?PERMISSION_CATALOG.map(p=>({ sourceType:'ROLE',sourceId:'fixture',permissionCode:p.code,
    resource:p.resource,scopeIds:['ALL'],validUntil:null })):[] });
test.before(()=>{db=createTestPrisma();});
test.beforeEach(async()=>{
  await clearTestApplicationData(db);
  org=key();await db.organization.create({data:{id:org,code:org,name:'协作测试',type:'FIRM',path:'/'+org}});
  const users=await Promise.all(['owner','reader','outsider'].map(username=>db.user.create({data:{username,password:'unused'}})));
  [owner,reader,outsider]=users.map((u,i)=>context(u.id,i===0));
  const svc=new CollaborationService(db,owner);
  workspace=(await svc.createWorkspace({name:'协作',organizationId:org},key())).id;
  base=(await svc.createBase(workspace,{name:'测试'},key())).id;
  table=(await svc.createTable(base,{name:'记录'},key())).id;
  const title=(await svc.describe(table)).fields[0];
  record=(await svc.saveRecord(table,undefined,{schemaVersion:1,values:{[title.id]:'记录'}},key())).id;
  await db.collabMember.create({data:{workspaceId:workspace,principalId:reader.userId,role:'READER',rowScope:'ALL'}});
});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();});

test('readers comment; mentions require row access; writes are idempotent and edits/deletions audited',async()=>{
  const svc=new RowComments(db,owner), viewer=new RowComments(db,reader), stranger=new RowComments(db,outsider);
  const people=await svc.recipients(table,record,'');
  assert.ok(people.some(p=>p.id===reader.userId));assert.ok(!people.some(p=>p.id===outsider.userId));
  await assert.rejects(svc.save(table,record,undefined,{content:'@outsider',mentions:[outsider.userId]},key()),/COMMENT_MENTION_FORBIDDEN/);
  await assert.rejects(stranger.list(table,record),/COLLAB_FORBIDDEN/);
  const mutation=key(), payload={content:'@reader 请核对',mentions:[reader.userId]};
  const row=await svc.save(table,record,undefined,payload,mutation);
  assert.equal((await svc.save(table,record,undefined,payload,mutation)).id,row.id);
  assert.equal(await db.notification.count({where:{userId:reader.userId}}),1);
  assert.ok((await db.notification.findFirstOrThrow()).routeUrl?.includes('comments=1'));
  assert.equal((await viewer.list(table,record))[0].content,payload.content);
  await assert.rejects(viewer.save(table,record,row.id,{content:'伪造修改',version:1},key()),/COLLAB_FORBIDDEN/);
  const reply=await viewer.save(table,record,undefined,{content:'已核对'},key());
  await viewer.save(table,record,reply.id,{content:'修改后的回复',version:1},key());
  await assert.rejects(viewer.save(table,record,reply.id,{content:'过期',version:1},key()),/COMMENT_VERSION_CONFLICT/);
  await viewer.save(table,record,reply.id,{remove:true,version:2},key());
  assert.equal((await svc.list(table,record)).length,1);
  assert.ok((await db.collabComment.findUniqueOrThrow({where:{id:reply.id}})).deletedAt);
  assert.equal(await db.operationLog.count({where:{targetId:reply.id,targetType:'COLLAB_COMMENT'}}),3);
  await db.collabMember.updateMany({where:{principalId:reader.userId},data:{rowScope:'SELF'}});
  await assert.rejects(viewer.list(table,record),/COLLAB_NOT_FOUND/);
  await assert.rejects(svc.save(table,record,undefined,payload,key()),/COMMENT_MENTION_FORBIDDEN/);
});

test('business-source rows support comments, while deleted records cannot be accessed',async()=>{
  const svc=new RowComments(db,owner);
  const business=await svc.createTable(base,{name:'线索记录',source:'LEADS'},key());
  const lead=await db.lead.create({data:{leadNo:key(),name:'业务线索',phone:'13800000000',phoneHash:key(),branchId:org,createdBy:owner.userId}});
  const row=await svc.save(business.id,lead.id,undefined,{content:'业务记录评论'},key());
  assert.equal((await svc.list(business.id,lead.id))[0].id,row.id);
  await db.collabRecord.update({where:{id:record},data:{archived:true}});
  await assert.rejects(svc.save(table,record,undefined,{content:'不可写入'},key()),/COLLAB_NOT_FOUND/);
});

const eventInput=()=>({title:'案件跟进',description:'核对材料',location:'会议室',startAt:'2030-01-02T08:00:00.000Z',
  endAt:'2030-01-02T09:00:00.000Z',important:true,visibility:'INVITEES',invitees:[reader.userId],reminders:[1440,60],tableId:table,recordId:record});
const range={from:'2030-01-01T00:00:00Z',to:'2030-01-04T00:00:00Z'};
test('calendar privacy, invitations, responses, business links and edit conflicts preserve access boundaries',async()=>{
  const svc=new CalendarService(db,owner), guest=new CalendarService(db,reader), stranger=new CalendarService(db,outsider);
  const idempotency=key(), input=eventInput();
  const event=await svc.saveEvent(undefined,input,idempotency);
  assert.equal((await svc.saveEvent(undefined,input,idempotency)).id,event.id);
  assert.equal((await svc.events(range)).rows.length,1);assert.equal((await guest.events(range)).rows.length,1);
  assert.equal((await stranger.events(range)).rows.length,0);
  await assert.rejects(stranger.eventDetail(event.id),/CALENDAR_NOT_FOUND/);
  assert.ok((await guest.eventDetail(event.id)).recordUrl?.includes('record='+record));
  await assert.rejects(stranger.respond(event.id,{status:'ACCEPTED',version:1},key()),/COLLAB_FORBIDDEN/);
  await guest.respond(event.id,{status:'TENTATIVE',version:1},key());
  assert.equal((await svc.eventDetail(event.id)).invitations[0].status,'TENTATIVE');
  await guest.respond(event.id,{status:'ACCEPTED',version:1},key());
  await assert.rejects(guest.saveEvent(event.id,{...input,version:1},key()),/COLLAB_FORBIDDEN/);
  await svc.saveEvent(event.id,{...input,startAt:'2030-01-02T08:30:00Z',version:1},key());
  assert.equal((await guest.eventDetail(event.id)).myResponse,'PENDING');
  await assert.rejects(guest.respond(event.id,{status:'ACCEPTED',version:1},key()),/CALENDAR_VERSION_CONFLICT/);
  await db.collabMember.deleteMany({where:{principalId:reader.userId}});
  assert.equal((await guest.eventDetail(event.id)).recordUrl,null);
  const privateEvent=await svc.saveEvent(undefined,{...input,visibility:'PRIVATE',invitees:[]},key());
  await assert.rejects(guest.eventDetail(privateEvent.id),/CALENDAR_NOT_FOUND/);
  const otherAdmin=new CalendarService(db,{...outsider,isSystemSuperAdmin:true});
  await assert.rejects(otherAdmin.eventDetail(privateEvent.id),/CALENDAR_NOT_FOUND/);
  const publicEvent=await svc.saveEvent(undefined,{...input,visibility:'PUBLIC',invitees:[]},key());
  assert.equal((await stranger.eventDetail(publicEvent.id)).recordUrl,null);
  await assert.rejects(svc.saveEvent(undefined,{...input,endAt:input.startAt},key()),/CALENDAR_INVALID_TIME/);
});

test('durable reminders catch up, deduplicate concurrent workers, skip declined invites and cancelled events',async()=>{
  const svc=new CalendarService(db,owner), guest=new CalendarService(db,reader), stranger=new CalendarService(db,outsider);
  const input={...eventInput(),invitees:[reader.userId,outsider.userId]};
  const event=await svc.saveEvent(undefined,input,key());
  await guest.respond(event.id,{status:'ACCEPTED',version:1},key());
  await stranger.respond(event.id,{status:'DECLINED',version:1},key());
  const results=await Promise.all([deliverCalendarReminders(db,new Date('2030-01-02T07:30:00Z')),deliverCalendarReminders(db,new Date('2030-01-02T07:30:00Z'))]);
  assert.equal(results.reduce((n,r)=>n+r.sent,0),4);
  assert.equal(await db.notification.count({where:{deduplicationKey:{contains:':reminder:'},userId:outsider.userId}}),0);
  assert.equal((await deliverCalendarReminders(db,new Date('2030-01-03T00:00:00Z'))).sent,0);
  await svc.saveEvent(event.id,{...input,title:'只修改说明',version:1},key());
  assert.equal((await deliverCalendarReminders(db,new Date('2030-01-03T00:00:00Z'))).sent,0);
  const cancelled=await svc.saveEvent(undefined,eventInput(),key());
  await svc.cancel(cancelled.id,{version:1},key());
  assert.equal((await deliverCalendarReminders(db,new Date('2030-01-03T00:00:00Z'))).sent,0);
  assert.ok((await guest.eventDetail(cancelled.id)).cancelledAt);
});

test('failed notification insert rolls back reminder completion and can be retried',async()=>{
  await new CalendarService(db,owner).saveEvent(undefined,{...eventInput(),invitees:[],reminders:[60]},key());
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_calendar_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated notification outage'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fail_calendar_notice BEFORE INSERT ON notification FOR EACH ROW EXECUTE FUNCTION fail_calendar_notice()');
  try { await assert.rejects(deliverCalendarReminders(db,new Date('2030-01-02T08:00:00Z')),/simulated notification outage/); }
  finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_calendar_notice ON notification');
    await db.$executeRawUnsafe('DROP FUNCTION fail_calendar_notice()');
  }
  assert.equal(await db.calendarReminder.count({where:{processedAt:null}}),1);
  assert.equal((await deliverCalendarReminders(db,new Date('2030-01-02T08:00:00Z'))).sent,1);
});

test('unified calendar projects existing visits and follows reschedule, cancel and business scope',async()=>{
  const {AppointmentService}=await import('../../app/application/crm/appointment-service');
  const lead=await db.lead.create({data:{leadNo:key(),name:'预约客户',phone:'13800000000',phoneHash:key(),status:'SCREENED',createdBy:owner.userId,branchId:org}});
  const appointments=new AppointmentService(db,{actorUserId:owner.userId},owner);
  const at=new Date('2026-11-20T02:00:00Z');
  const visit=await appointments.createAppointment(lead.id,{scheduledAt:at,channel:'ONSITE'});
  const calendar=new CalendarService(db,owner);
  const range={from:'2026-11-01T00:00:00Z',to:'2026-12-01T00:00:00Z',type:'VISIT'};
  const first=await calendar.events(range);
  assert.equal(first.rows.length,1);
  assert.equal(first.rows[0].id,'visit:'+visit.id);
  assert.equal((await new CalendarService(db,outsider).events(range)).rows.length,0);
  await assert.rejects(new CalendarService(db,outsider).eventDetail('visit:'+visit.id));
  const moved=await appointments.reschedule(visit.id,new Date('2026-11-21T02:00:00Z'));
  const second=await calendar.events(range);
  assert.equal(second.rows.length,1);
  assert.equal(second.rows[0].id,'visit:'+moved.id);
  await appointments.cancel(moved.id);
  assert.equal((await calendar.events(range)).rows.length,0);
  assert.equal(await db.calendarEvent.count(),0);
  assert.equal(await db.calendarReminder.count(),0);
});
