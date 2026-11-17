import { CollabField, CollabTable, Prisma } from '@prisma/client';
import type { AuthorizationContext } from '../authorization/authorization-service';
import { fail, object } from './collaboration-policy';

type Tx = Prisma.TransactionClient;
export const isProspectTable = (table: Pick<CollabTable, 'source' | 'name'>) => table.source === 'CUSTOM' && table.name.includes('客资');
export const isProspectAssignee = (field: Pick<CollabField, 'options'>) => object(field.options).prospectAssignee === true;
export const prospectField = (fields: CollabField[]) => fields.find(f => !f.archived && isProspectAssignee(f));
export type ProspectAssignment = {
  fieldId: string; organizationId: string; canAssign: boolean; all: boolean; unassigned: boolean;
  employeeIds: string[]; candidates: {id: string; name: string; label?: string}[];
};

export async function assignmentOrganizations(tx: Tx, actor: AuthorizationContext, workspaceOrganizationId: string) {
  const all = await tx.organization.findMany({where: {status: 'ENABLED'}, select: {id: true, name: true, path: true, managerEmployeeId: true}});
  const employee = actor.employeeId && await tx.employee.findFirst({where:{id:actor.employeeId,deletedAt:null,status:{not:'LEAVED'}},select:{id:true}});
  const roots = all.filter(o => o.id === workspaceOrganizationId || (!!employee && o.managerEmployeeId === actor.employeeId));
  return all.filter(o => actor.isSystemSuperAdmin || roots.some(root => o.id === root.id || o.path.startsWith(root.path + '/')))
    .map(o=>({...o,label:o.path.split('/').filter(Boolean).map(id=>all.find(p=>p.id===id)?.name).filter(Boolean).join(' / ')}));
}

export async function assignmentEmployees(tx: Tx, organizationId: string) {
  const root = await tx.organization.findFirst({where: {id: organizationId, status: 'ENABLED'}, select:{id:true,path:true}});
  if (!root) return [];
  const now = new Date();
  const people = await tx.employee.findMany({where: {deletedAt:null,status:{not:'LEAVED'},assignments:{some:{
    startedAt:{lte:now},OR:[{endedAt:null},{endedAt:{gt:now}}],position:{status:'ENABLED',deletedAt:null},
    organization:{status:'ENABLED',OR:[{id:root.id},{path:{startsWith:root.path+'/'}}]},
  }}},select:{id:true,name:true,employeeNo:true,user:{select:{username:true}},assignments:{where:{startedAt:{lte:now},OR:[{endedAt:null},{endedAt:{gt:now}}],position:{status:'ENABLED',deletedAt:null},organization:{status:'ENABLED'}},select:{organization:{select:{name:true,parent:{select:{name:true}}}}}}},orderBy:[{name:'asc'},{id:'asc'}]});
  return people.map(e=>({id:e.id,name:e.name,label:`${e.name}（${e.assignments.map(a=>[a.organization.parent?.name,a.organization.name].filter(Boolean).join(' / ')).join('、')} · ${e.user?.username || e.employeeNo}）`}));
}

export async function resolveAssignment(tx: Tx, actor: AuthorizationContext, field: CollabField, fallbackOrg: string): Promise<ProspectAssignment> {
  const organizationId = String(object(field.options).assignmentOrganizationId || fallbackOrg);
  const root = await tx.organization.findFirst({where:{id:organizationId,status:'ENABLED'},select:{id:true,path:true}});
  const active = actor.employeeId && await tx.employee.findFirst({where:{id:actor.employeeId,deletedAt:null,status:{not:'LEAVED'}},select:{id:true}});
  const managed = root && active ? await tx.organization.findMany({where:{status:'ENABLED',managerEmployeeId:actor.employeeId,
    OR:[{id:root.id},{path:{startsWith:root.path+'/'}},{id:{in:root.path.split('/').filter(Boolean)}}]},select:{id:true,path:true}}) : [];
  const whole = !!root && managed.some(o => root.id === o.id || root.path.startsWith(o.path+'/'));
  const canAssign = actor.isSystemSuperAdmin || managed.length > 0;
  const allCandidates = root ? await assignmentCandidates(tx, root.id) : [];
  const team = whole || actor.isSystemSuperAdmin ? allCandidates : (await Promise.all(managed.map(o => assignmentEmployees(tx,o.id)))).flat();
  const employeeIds = [...new Set([...team.map(e => e.id), ...(active && allCandidates.some(e=>e.id===active.id) ? [active.id] : [])])];
  return {fieldId:field.id,organizationId,canAssign,all:actor.isSystemSuperAdmin || whole,unassigned:whole || actor.isSystemSuperAdmin,
    employeeIds,candidates:canAssign ? allCandidates.filter(e=>actor.isSystemSuperAdmin || employeeIds.includes(e.id)) : allCandidates.filter(e=>e.id===actor.employeeId)};
}

export function assignmentPredicate(assignment: ProspectAssignment) {
  if (assignment.all) return Prisma.sql`TRUE`;
  const value = Prisma.sql`r.values->>${assignment.fieldId}`;
  return Prisma.sql`(${assignment.employeeIds.length ? Prisma.sql`${value} IN (${Prisma.join(assignment.employeeIds)})` : Prisma.sql`FALSE`}
    OR ${assignment.unassigned ? Prisma.sql`(${value} IS NULL OR ${value}='')` : Prisma.sql`FALSE`})`;
}

export async function validateAssignmentConfig(tx: Tx, actor: AuthorizationContext, workspaceOrg: string, field: CollabField) {
  const org = String(object(field.options).assignmentOrganizationId || workspaceOrg);
  if (!(await assignmentOrganizations(tx,actor,workspaceOrg)).some(o=>o.id===org)) fail('COLLAB_ASSIGNMENT_ORGANIZATION_FORBIDDEN',403);
  if (field.defaultValue != null && !(await assignmentCandidates(tx,org)).some(e=>e.id===field.defaultValue)) fail('COLLAB_MEMBER_UNAVAILABLE',422,{fieldId:field.id});
}

/** The department policy still limits the assignment ceiling, but follows the employee,
 * not the creator (a supervisor often enters records on somebody else's behalf). */
export function assignmentDepartmentPredicate(field: CollabField, employeeId: string | null, descendants: boolean) {
  if (!employeeId) return Prisma.sql`FALSE`;
  const value = Prisma.sql`r.values->>${field.id}`;
  const org = String(object(field.options).assignmentOrganizationId || '');
  return Prisma.sql`(EXISTS (SELECT 1 FROM organization managed JOIN organization configured ON configured.id=${org}
      WHERE managed.status='ENABLED' AND configured.status='ENABLED' AND managed."managerEmployeeId"=${employeeId}
        AND (managed.id=configured.id OR starts_with(configured.path,managed.path||'/')))
    OR ${value}=${employeeId} OR ${value} IN (
    SELECT a."employeeId" FROM employee_assignment a JOIN organization o ON o.id=a."organizationId"
    JOIN position p ON p.id=a."positionId" JOIN employee e ON e.id=a."employeeId"
    WHERE e."deletedAt" IS NULL AND e.status<>'LEAVED' AND p.status='ENABLED' AND p."deletedAt" IS NULL
      AND o.status='ENABLED' AND a."startedAt"<=CURRENT_TIMESTAMP AND (a."endedAt" IS NULL OR a."endedAt">CURRENT_TIMESTAMP)
      AND EXISTS (SELECT 1 FROM organization root WHERE root.status='ENABLED'
        AND (root."managerEmployeeId"=${employeeId} ${descendants ? Prisma.empty : Prisma.sql`OR root.id IN (
          SELECT own."organizationId" FROM employee_assignment own JOIN position op ON op.id=own."positionId"
          WHERE own."employeeId"=${employeeId} AND op.status='ENABLED' AND op."deletedAt" IS NULL AND own."startedAt"<=CURRENT_TIMESTAMP AND (own."endedAt" IS NULL OR own."endedAt">CURRENT_TIMESTAMP))`})
        AND (o.id=root.id ${descendants ? Prisma.sql`OR starts_with(o.path,root.path||'/')` : Prisma.empty})))
    OR ((${value} IS NULL OR ${value}='') AND EXISTS (
      SELECT 1 FROM organization managed JOIN organization configured ON configured.id=${org}
      WHERE managed.status='ENABLED' AND configured.status='ENABLED' AND managed."managerEmployeeId"=${employeeId}
        AND (managed.id=configured.id OR starts_with(configured.path,managed.path||'/')))))`;
}

/** Branch offices share the same top-level firm; unrelated organizations stay excluded. */
export async function assignmentCandidates(tx: Tx, organizationId: string) {
  const org = await tx.organization.findFirst({where:{id:organizationId,status:'ENABLED'},select:{path:true}});
  if (!org) return [];
  return assignmentEmployees(tx,org.path.split('/').filter(Boolean)[0]);
}
