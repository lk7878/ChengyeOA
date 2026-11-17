import test from 'node:test';
import assert from 'node:assert/strict';
import SmartCaseController from '../../app/controller/smartCase';
import {AuthorizationContext} from '../../app/application/authorization/authorization-service';

test('entry config requires menu access and checks case access before exposing a direct entry',async()=>{
  const previous=process.env.SMART_CASE_PUBLIC_URL;
  process.env.SMART_CASE_PUBLIC_URL='https://smart.example';
  const authorization:AuthorizationContext={userId:'current',employeeId:null,isSystemSuperAdmin:false,isSystemAdmin:false,grants:[],fieldRules:[],permissionCodes:[],evaluatedAt:new Date()};
  let result:unknown;
  const ctx={state:{user:{userId:'current'},authorization},query:{} as Record<string,string>,prisma:{}};
  const controller={ctx,respond(data:unknown){result=data;}} as unknown as SmartCaseController;
  try{
    await assert.rejects(SmartCaseController.prototype.entryConfig.call(controller));
    assert.equal(result,undefined);
    authorization.permissionCodes=['menu.smart_case'];
    await SmartCaseController.prototype.entryConfig.call(controller);
    assert.deepEqual(result,{url:'https://smart.example/api/auth/start',homeUrl:'https://smart.example/wb/',userId:'current'});
    result=undefined;ctx.query.caseId='not-authorized';
    await assert.rejects(SmartCaseController.prototype.entryConfig.call(controller));
    assert.equal(result,undefined);
  }finally{if(previous===undefined)delete process.env.SMART_CASE_PUBLIC_URL;else process.env.SMART_CASE_PUBLIC_URL=previous;}
});
