import assert from 'node:assert/strict';
import test from 'node:test';
import type { Context } from 'egg';
import type { Prisma, PrismaClient } from '@prisma/client';
import retiredModules from '../../app/middleware/retiredModules';
import { SopReminderScanner, SopReminderHandler } from '../../app/application/sop/sop-reminder';
import { SopChangeNotification, QualityChangeNotification } from '../../app/application/sop/change-notification';
import { AssessmentHandler } from '../../app/application/quality/assessment-handler';
import type { EventHandlerContext } from '../../app/application/events/event-delivery-store';

test('retired modules allow historical reads and reject mutations without affecting performance',async()=>{
  const middleware=retiredModules();
  let calls=0;
  const next=async()=>{calls++;};
  const request=(method:string,path:string,body={})=>middleware({method,path,request:{body}} as Context,next);
  for(const path of ['/api/v1/sop/instances','/api/v1/quality/reviews','/api/v1/cases/case-id/assessments']) {
    await request('GET',path);
    await assert.rejects(request('POST',path),(error:unknown)=>(error as {code:string}).code==='MODULE_RETIRED');
  }
  await assert.rejects(request('POST','/api/v1/admin/operations',{operationType:'SOP_TEMPLATE_PUBLISH'}));
  await request('POST','/api/v1/performances');
  assert.equal(calls,4);
});

test('retired background jobs neither create reviews nor send reminders or notifications',async()=>{
  const unused=new Proxy({}, {get(){throw new Error('Retired module accessed persistence');}});
  await new SopReminderScanner(unused as PrismaClient).scanOnce(new Date());
  for(const handler of [new SopReminderHandler(),new SopChangeNotification(),new QualityChangeNotification(),new AssessmentHandler()])
    await handler.handle(unused as Prisma.TransactionClient,{} as EventHandlerContext);
});
