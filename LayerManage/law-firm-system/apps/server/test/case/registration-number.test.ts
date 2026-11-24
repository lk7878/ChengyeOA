import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { REGISTRATION_NUMBER_RULES, allocateRegistrationNumber, validateRegistrationNumber } from '../../app/application/case/registration-number';

test('nine contract series: exact format, shared category sequence, concurrent allocation and rollback without gaps',async()=>{
 const db=createTestPrisma();
 try {
  await clearTestApplicationData(db);
  const now=new Date('2026-11-24T00:00:00+08:00');
  for(const r of REGISTRATION_NUMBER_RULES){
   const n=await db.$transaction(tx=>allocateRegistrationNumber(tx,'test-'+r.code,r.code,now));
   assert.equal(n,`渝承${r.word}字（2026）${r.code}26${'1'.padStart(r.digits,'0')}`);
   assert.equal(validateRegistrationNumber(n),n);
  }
  for(const bad of ['渝承民字（2026）MS26001','渝承刑字（2026）XS260001','渝承专字（2026）XS26001','渝承民字（2026）MS250001','渝承民字（2026）MS260000']) assert.throws(()=>validateRegistrationNumber(bad));
  await assert.rejects(db.$transaction(async tx=>{await allocateRegistrationNumber(tx,'rollback','MS',now);throw Error('rollback');}),/rollback/);
  const nums=await Promise.all(Array.from({length:6},(_,i)=>db.$transaction(tx=>allocateRegistrationNumber(tx,'parallel-'+i,'MS',now),{timeout:15000})));
  assert.deepEqual(nums.sort(),[2,3,4,5,6,7].map(n=>'渝承民字（2026）MS26'+String(n).padStart(4,'0')));
  assert.equal(await db.$transaction(tx=>allocateRegistrationNumber(tx,'next-year','MS',new Date('2026-12-31T16:00:00Z'))),'渝承民字（2027）MS270001');
  assert.equal(await db.$transaction(tx=>allocateRegistrationNumber(tx,'criminal-special','XS',now)),'渝承刑字（2026）XS26002');
 }finally{await clearTestApplicationData(db);await db.$disconnect();}
});
