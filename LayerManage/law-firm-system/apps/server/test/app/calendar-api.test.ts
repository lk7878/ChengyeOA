import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { SessionService } from '../../app/application/auth/session-service';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
process.env.EGG_TYPESCRIPT='true';
const app=mm.app();
let db:PrismaClient;
test.before(async()=>{db=createTestPrisma();await app.ready();});
test.after(async()=>{await clearTestApplicationData(db);await db.$disconnect();await app.close();await mm.restore();});
test('authenticated calendar API supports private events, scoped invitations and notification links',async()=>{
  await clearTestApplicationData(db);
  const users=await Promise.all(['owner','guest'].map(username=>db.user.create({data:{username,password:'unused'}})));
  const sessions=new SessionService(db,new JwtTokenService('01234567890123456789012345678901'));
  const a=await sessions.create(users[0].id,'PASSWORD',{}),b=await sessions.create(users[1].id,'PASSWORD',{});
  const payload={title:'重要事项',startAt:'2030-01-01T08:00:00Z',endAt:'2030-01-01T09:00:00Z',visibility:'PRIVATE',invitees:[],reminders:[60]};
  await app.httpRequest().get('/api/v1/calendar/events?from=2030-01-01T00:00:00Z&to=2030-01-03T00:00:00Z').expect(401);
  const created=await app.httpRequest().post('/api/v1/calendar/events').set('Authorization','Bearer '+a.accessToken)
    .set('Idempotency-Key',key()).send(payload).expect(200);
  const id=created.body.data.id;
  await app.httpRequest().get('/api/v1/calendar/events/'+id).set('Authorization','Bearer '+b.accessToken).expect(404);
  await app.httpRequest().patch('/api/v1/calendar/events/'+id).set('Authorization','Bearer '+a.accessToken)
    .set('Idempotency-Key',key()).send({...payload,version:1,visibility:'INVITEES',invitees:[users[1].id]}).expect(200);
  const notices=await app.httpRequest().get('/api/v1/notifications').set('Authorization','Bearer '+b.accessToken).expect(200);
  assert.equal(notices.body.data.list[0].routeUrl,'/calendar?event='+id);
  await app.httpRequest().post('/api/v1/calendar/events/'+id+'/respond').set('Authorization','Bearer '+b.accessToken)
    .set('Idempotency-Key',key()).send({version:2,status:'ACCEPTED'}).expect(200);
  const detail=await app.httpRequest().get('/api/v1/calendar/events/'+id).set('Authorization','Bearer '+a.accessToken).expect(200);
  assert.equal(detail.body.data.invitations[0].status,'ACCEPTED');
});
