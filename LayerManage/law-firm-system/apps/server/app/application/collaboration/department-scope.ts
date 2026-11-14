import { Prisma } from '@prisma/client';
// Resolve current appointments and employment at query time. No cached list of staff.
export function departmentCreatorPredicate(userId:string,employeeId:string|null,descendants:boolean){
  if(!employeeId)return Prisma.sql`r."createdBy"=${userId}`;
  return Prisma.sql`(r."createdBy"=${userId} OR r."createdBy" IN (
    SELECT u.id FROM "user" u JOIN employee e ON e.id=u."employeeId"
    JOIN employee_assignment a ON a."employeeId"=e.id JOIN organization o ON o.id=a."organizationId"
    JOIN position p ON p.id=a."positionId"
    WHERE u.status='ENABLED' AND e."deletedAt" IS NULL AND e.status<>'LEAVED'
      AND p.status='ENABLED' AND p."deletedAt" IS NULL AND o.status='ENABLED' AND a."startedAt"<=CURRENT_TIMESTAMP AND (a."endedAt" IS NULL OR a."endedAt">CURRENT_TIMESTAMP)
      AND EXISTS (SELECT 1 FROM organization root WHERE root.status='ENABLED'
        AND EXISTS (SELECT 1 FROM employee manager WHERE manager.id=${employeeId} AND manager."deletedAt" IS NULL AND manager.status<>'LEAVED')
        AND (root."managerEmployeeId"=${employeeId} ${descendants?Prisma.empty:Prisma.sql`OR root.id IN (
          SELECT own."organizationId" FROM employee_assignment own JOIN position op ON op.id=own."positionId"
          WHERE own."employeeId"=${employeeId} AND op.status='ENABLED' AND op."deletedAt" IS NULL AND own."startedAt"<=CURRENT_TIMESTAMP AND (own."endedAt" IS NULL OR own."endedAt">CURRENT_TIMESTAMP))`})
        AND (o.id=root.id ${descendants?Prisma.sql`OR starts_with(o.path,root.path||'/')`:Prisma.empty}))
  ))`;
}
