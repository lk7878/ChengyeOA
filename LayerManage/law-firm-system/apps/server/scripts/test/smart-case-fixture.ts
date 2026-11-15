import 'dotenv/config';
import {writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createTestPrisma,clearTestApplicationData} from '../../test/helpers/test-database';
import {SessionService} from '../../app/application/auth/session-service';
import {JwtTokenService} from '../../app/domain/security/token-service';
import {PERMISSION_CATALOG} from '../../app/domain/authorization/permission-catalog';
async function main(){
const dir=process.env.SMART_CASE_TEST_ROOT;if(!dir)throw Error('SMART_CASE_TEST_ROOT required');
const db=createTestPrisma();await clearTestApplicationData(db);await mkdir(dir,{recursive:true,mode:0o700});
const jwtSecret=randomBytes(32).toString('hex'),clientSecret=randomBytes(32).toString('hex');const users=[];
for(const [code,name]of [['SYSTEM_SUPER_ADMIN','合成超级管理员'],['E2E_LAWYER','合成律师']]){
 const role=await db.role.create({data:{code,name,type:code==='SYSTEM_SUPER_ADMIN'?'SYSTEM':'BUSINESS'}});
 if(code!=='SYSTEM_SUPER_ADMIN'){const scope=await db.dataScope.create({data:{name:'合成验收案件范围',scopeType:'ALL'}});await db.roleDataScope.create({data:{roleId:role.id,resource:'case',dataScopeId:scope.id}})}
 if(code!=='SYSTEM_SUPER_ADMIN')for(const permission of PERMISSION_CATALOG.filter(p=>['menu.smart_case','case.read','case.file.manage','knowledge.review'].includes(p.code)))await db.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});
 for(const suffix of code==='SYSTEM_SUPER_ADMIN'?['admin']:['alice','bob']){const u=await db.user.create({data:{username:'smart-e2e-'+suffix,password:'not-a-password-hash',mustChangePassword:false}});await db.userRole.create({data:{userId:u.id,roleId:role.id}});const credentials=await new SessionService(db,new JwtTokenService(jwtSecret)).create(u.id,'MFA',{ip:'127.0.0.1',userAgent:'synthetic-integration-test'});users.push({id:u.id,name:suffix,...credentials})}
}
const customer=await db.customer.create({data:{customerNo:'SYNTHETIC-CUSTOMER',name:'脱敏验收客户',phone:'000',phoneHash:'synthetic',createdBy:users.find(u=>u.name==='alice')!.id}});
const caseRow=await db.case.create({data:{caseNo:'SYNTHETIC-CASE',title:'合成办案验收案',customerId:customer.id,caseType:'民事',status:'PENDING',createdBy:users.find(u=>u.name==='alice')!.id}});
await writeFile(dir+'/fixtures.json',JSON.stringify({jwtSecret,clientSecret,users,caseId:caseRow.id}),{mode:0o600});await db.$disconnect();console.log('Created isolated synthetic users and OA sessions');

}
main().catch(error=>{console.error(error);process.exitCode=1});
