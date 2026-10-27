import { CollabField, Prisma } from '@prisma/client';
import { fail, object } from './collaboration-policy';

export const hrKinds = ['HR_ROSTER','HR_INTERNS','HR_CONTACTS','HR_HQ_LAWYERS','HR_BRANCH_LAWYERS','HR_LEAVERS','HR_NEW_HIRES','HR_RECRUITMENT'] as const;
export type HrKind = typeof hrKinds[number];
export const isHrKind = (kind: unknown): kind is HrKind => hrKinds.includes(kind as HrKind);
export const hrNames: Record<HrKind,string> = {
  HR_ROSTER:'律所员工名册', HR_INTERNS:'实习律师名单', HR_CONTACTS:'重庆承业律师事务所员工名单及通讯录',
  HR_HQ_LAWYERS:'总所在册律师名单', HR_BRANCH_LAWYERS:'派驻分所律师明细', HR_LEAVERS:'离职人员名单', HR_NEW_HIRES:'新入职人员名单', HR_RECRUITMENT:'招聘面试',
};
type Spec = [name:string,type?:string,required?:boolean];
const lawyers:Spec[] = [['序号','AUTONUMBER'],['部门','TEXT',true],['姓名','TEXT',true],['性别','SINGLE_SELECT'],['职务'],['执业证号','TEXT',true],['执业年限','NUMBER',true],['身份证号'],['年龄','FORMULA'],['学历'],['联系电话']];
const definitions:Record<HrKind,Spec[]> = {
  HR_ROSTER:[['序号','AUTONUMBER'],['部门','SINGLE_SELECT',true],['姓 名','TEXT',true],['性别','SINGLE_SELECT'],['职务','TEXT',true],['电 话','TEXT',true],['身份证号码'],['入职时间','DATETIME',true],['出生年月'],['籍贯'],['民族'],['政治面貌'],['执业证号'],['资格证号'],['邮箱'],['实习协议（劳动合同）时间'],['社保情况'],['学历'],['毕业院校及时间'],['紧急联系人及电话'],['现居住地'],['户籍所在地'],['留存资料','LONG_TEXT'],['留存资料附件','FILE'],['职业状态','SINGLE_SELECT']],
  HR_INTERNS:[['序号','AUTONUMBER'],['姓 名','TEXT',true],['职务'],['性别','SINGLE_SELECT'],['执业（实习）核准时间','DATETIME'],['实习证号'],['资格证号'],['身份证号码'],['电 话'],['指导律师','TEXT',true],['所在部门/团队'],['备注','LONG_TEXT']],
  HR_CONTACTS:[['序号','AUTONUMBER'],['部门','TEXT',true],['姓名','TEXT',true],['职务','TEXT',true],['电话','TEXT',true],['备注','LONG_TEXT']],
  HR_HQ_LAWYERS:lawyers, HR_BRANCH_LAWYERS:lawyers,
  HR_LEAVERS:[['序号','AUTONUMBER'],['部门','TEXT',true],['姓名','TEXT',true],['性别','SINGLE_SELECT'],['职务'],['电话'],['身份证号'],['入职时间','DATETIME',true],['离职时间','DATETIME',true]],
  HR_NEW_HIRES:[['ID','AUTONUMBER'],['入职部门','TEXT',true],['岗位','TEXT',true],['填表日期','DATETIME'],['员工编号'],['应聘者姓名','TEXT',true],['性别','SINGLE_SELECT'],['出生日期','DATETIME'],['籍贯'],['民族'],['身高','NUMBER'],['体重','NUMBER'],['血型','SINGLE_SELECT'],['政治面貌'],['婚姻状况','SINGLE_SELECT'],['职业状况','SINGLE_SELECT'],['最高学历','SINGLE_SELECT'],['毕业学校'],['个人相片','FILE'],['电话号码'],['邮箱'],['身份证号'],['现居住地'],['户籍类型','SINGLE_SELECT'],['户籍所在地'],['紧急联系人'],['紧急联系人电话'],['姓名'],['计算机水平'],['入职时间','DATETIME'],['入学时间','DATETIME'],['毕业时间','DATETIME'],['学校/培训机构'],['专业/培训内容'],['所获学历/资质'],['离职时间','DATETIME'],['职务/主要工作职责','LONG_TEXT'],['薪酬'],['离职原因'],['外语（语种）'],['级别'],['其他技能','LONG_TEXT'],['个人爱好及特长','LONG_TEXT'],['脱产/在职','SINGLE_SELECT'],['称谓'],['工作单位'],['职务'],['联系电话'],['证明人及电话'],['证明人和电话'],['能否出差','SINGLE_SELECT'],['能否加班','SINGLE_SELECT'],['能否接受工作调动','SINGLE_SELECT'],['是否曾在我公司应聘','SINGLE_SELECT'],['是否有亲属朋友在我公司工作','SINGLE_SELECT'],['亲属姓名']],
  HR_RECRUITMENT:[['序号','AUTONUMBER'],['招聘岗位','TEXT',true],['候选人姓名','TEXT',true],['招聘渠道','SINGLE_SELECT'],['联系方式'],['面试状态','SINGLE_SELECT',true],['面试时间','DATETIME'],['入职日期','DATETIME'],['招聘负责人','TEXT',true],['备注','LONG_TEXT']],
};
const choices:Record<string,string[]> = {
  部门:['律师部','侵权中心','综合服务部','大数据运营中心','新媒体','贵阳分所','万州分所','铜梁分所','绵阳分所','成都分所','黔江分所'],
  性别:['男','女'],职业状态:['在职','离职'],血型:['A型','B型','AB型','O型','其他'],婚姻状况:['未婚','已婚','离异','丧偶'],职业状况:['在职','离职','待业'],最高学历:['高中及以下','中专','专科','本科','硕士','博士','其他'],户籍类型:['城镇','农村'],'脱产/在职':['脱产','在职'],
  能否出差:['能','否'],能否加班:['能','否'],能否接受工作调动:['能','否'],是否曾在我公司应聘:['是','否'],是否有亲属朋友在我公司工作:['是','否'],
  招聘渠道:['Boss直聘','智联招聘','前程无忧','内部推荐','猎头','校招','其他'],面试状态:['简历初筛','待初试','待复试','已通过','已淘汰','已入职'],
};
export function hrFields(kind:HrKind) {
  return definitions[kind].map(([name,type='TEXT',required=false],position)=>({
    name,type,required,position,
    defaultValue:(name==='职业状态'?'在职':Prisma.DbNull) as Prisma.InputJsonValue|typeof Prisma.DbNull,
    options:{inventoryKey:name,hrField:true,...(position===0?{primary:true}:{}),
      ...(/身份证/.test(name)?{hrIdentity:true}:{}),
      ...(/身份证|电话|电 话|联系方式|薪酬|居住|户籍|出生|邮箱|紧急联系人|留存资料|个人相片/.test(name)||(kind==='HR_NEW_HIRES'&&['姓名','称谓','工作单位','职务','证明人和电话','亲属姓名','离职原因'].includes(name))||(kind==='HR_RECRUITMENT'&&name==='备注')?{hrSensitive:true}:{}),
      ...(name==='年龄'?{hrAge:true,helpText:'按当前年份减身份证出生年份计算，只读。'}:{}),
      ...(type==='DATETIME'&&name!=='面试时间'?{dateOnly:true}:{}),
      ...(name==='入职时间'?{hrPartialDate:true,helpText:'可填写2024.06或2024-06；仅有月份时保留月份，不补日期。'}:{}),
      ...(name==='面试时间'?{dateMinute:true}:{}),...(name==='填表日期'?{defaultNow:true}:{}),
      ...(name==='执业年限'?{nonnegativeInteger:true}:{}),
      ...(kind==='HR_NEW_HIRES'&&name==='姓名'?{helpText:'家庭成员姓名'}:{}),
      ...(name==='亲属姓名'?{helpText:'有亲属朋友在本公司工作时必填。'}:{}),
      ...(type==='SINGLE_SELECT'?{choices:choices[name].map(value=>({id:value,name:value}))}:{}),
    } as Prisma.InputJsonObject,
  }));
}
export function validateHrRecord(kind:unknown,fields:CollabField[],values:Record<string,unknown>) {
  if(kind!=='HR_NEW_HIRES') return;
  const field=fields.find(f=>!f.archived&&f.name==='亲属姓名');
  const has=fields.find(f=>!f.archived&&f.name==='是否有亲属朋友在我公司工作');
  if(field&&has&&values[has.id]==='是'&&!String(values[field.id]??'').trim()) fail('COLLAB_REQUIRED_FIELD',422,{fieldId:field.id});
}
export function hrPrivate(field:CollabField) { return !!object(field.options).hrSensitive; }
