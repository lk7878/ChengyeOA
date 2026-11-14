import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const serverRoot = path.resolve(__dirname, '../..');
const routerSource = fs.readFileSync(path.join(serverRoot, 'app/router.ts'), 'utf8');
const routerWithoutPermissionMiddleware = routerSource.replace(
  /,\s*requirePermission\('[^']+'\)/g,
  '',
);

const approvedRoutes = [
  "router.get('/api/v1/employees', controller.employee.index)",
  "router.get('/api/v1/employees/:id', controller.employee.show)",
  "router.post('/api/v1/employees', controller.employee.create)",
  "router.patch('/api/v1/employees/:id', controller.employee.update)",
  "router.post('/api/v1/employees/:id/formalize', controller.employee.formalize)",
  "router.post('/api/v1/employees/:id/leave', controller.employee.leave)",
  "router.post('/api/v1/employees/:id/assignments/transfer', controller.employeeAssignment.transfer)",
  "router.post('/api/v1/employees/:id/assignments', controller.employeeAssignment.create)",
  "router.post('/api/v1/employees/:id/assignments/:assignmentId/end', controller.employeeAssignment.end)",
  "router.put('/api/v1/employees/:id/account-binding', controller.employeeAccountBinding.update)",
  "router.delete('/api/v1/employees/:id/account-binding', controller.employeeAccountBinding.destroy)",
  "router.get('/api/v1/professional-teams', controller.professionalTeam.index)",
  "router.get('/api/v1/professional-teams/:id', controller.professionalTeam.show)",
  "router.post('/api/v1/professional-teams', controller.professionalTeam.create)",
  "router.patch('/api/v1/professional-teams/:id', controller.professionalTeam.update)",
  "router.post('/api/v1/professional-teams/:id/disable', controller.professionalTeam.disable)",
  "router.post('/api/v1/professional-teams/:id/enable', controller.professionalTeam.enable)",
  "router.post('/api/v1/professional-teams/:id/members', controller.professionalTeam.addMember)",
  "router.post('/api/v1/professional-teams/:id/members/:memberId/end', controller.professionalTeam.endMember)",
  "router.post('/api/v1/professional-teams/:id/lead', controller.professionalTeam.replaceLead)",
];

test('registers the complete SPEC-003 employee, assignment, account, and team routes', () => {
  for (const route of approvedRoutes) {
    assert.ok(routerWithoutPermissionMiddleware.includes(`${route};`), `missing ${route}`);
  }
});

test('exposes protected versioned deletion and removes obsolete employee update routes', () => {
  assert.ok(routerSource.includes("router.delete('/api/v1/organizations/:id', requireOrganizationSuperAdmin, requirePermission('organization.update'), controller.organization.destroy)"));
  assert.ok(routerSource.includes("router.delete('/api/v1/positions/:id', requirePermission('position.update'), controller.position.destroy)"));
  assert.ok(routerSource.includes("router.delete('/api/v1/employees/:id', requirePermission('employee.leave'), controller.employee.destroy)"));
  assert.ok(!routerSource.includes("router.put('/api/v1/employees/:id'"));
});

test('keeps new HTTP controllers thin and free of direct Prisma access', () => {
  for (const filename of [
    'employee.ts',
    'employeeAssignment.ts',
    'employeeAccountBinding.ts',
    'professionalTeam.ts',
  ]) {
    const source = fs.readFileSync(path.join(serverRoot, 'app/controller', filename), 'utf8');
    assert.doesNotMatch(source, /ctx\.prisma|\$transaction|operationLog\./, filename);
  }
});

test('removes direct employee organization ownership from downstream controllers', () => {
  for (const filename of ['auth.ts', 'user.ts', 'lead.ts', 'case.ts', 'performance.ts']) {
    const source = fs.readFileSync(path.join(serverRoot, 'app/controller', filename), 'utf8');
    assert.doesNotMatch(source, /\borgId:\s*true|\bpositionId:\s*true/, filename);
    assert.doesNotMatch(source, /employee:[\s\S]{0,160}\borganization:\s*true/, filename);
    assert.doesNotMatch(source, /employee:[\s\S]{0,160}\bposition:\s*true/, filename);
  }
  // Controllers that embed employee projections must route them through the primary-assignment
  // projector. lead.ts/case.ts/performance.ts embed no employee projection in the controller
  // (lead: masked in the frozen CRM service layer; case: CaseView exposes only lawyerId;
  // performance: PerformanceView.employee is projected inside the service layer via
  // projectEmployeeWithPrimaryAssignment), so they stay under the negative assertions above but
  // are exempt from the projector reference requirement.
  for (const filename of ['auth.ts', 'user.ts']) {
    const source = fs.readFileSync(path.join(serverRoot, 'app/controller', filename), 'utf8');
    assert.match(source, /projectEmployeeWithPrimaryAssignment/, filename);
  }
});

test('prevents generic user mutations from bypassing dedicated employee account binding', () => {
  const source = fs.readFileSync(path.join(serverRoot, 'app/controller/user.ts'), 'utf8');
  assert.doesNotMatch(source, /updateData\.employeeId\s*=/);
  assert.doesNotMatch(source, /data:\s*\{[\s\S]{0,240}\bemployeeId,/);
  assert.match(source, /ACCOUNT_BINDING_REQUIRES_DEDICATED_ENDPOINT/);
});
