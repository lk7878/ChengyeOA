import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const serverRoot = path.resolve(__dirname, '../..');
const routerSource = fs.readFileSync(path.join(serverRoot, 'app/router.ts'), 'utf8');

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
  for (const route of approvedRoutes) assert.ok(routerSource.includes(`${route};`), `missing ${route}`);
});

test('removes physical delete and obsolete employee update routes', () => {
  assert.ok(!routerSource.includes("router.delete('/api/v1/organizations/:id'"));
  assert.ok(!routerSource.includes("router.delete('/api/v1/positions/:id'"));
  assert.ok(!routerSource.includes("router.delete('/api/v1/employees/:id'"));
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
    assert.match(source, /projectEmployeeWithPrimaryAssignment/, filename);
  }
});

test('prevents generic user mutations from bypassing dedicated employee account binding', () => {
  const source = fs.readFileSync(path.join(serverRoot, 'app/controller/user.ts'), 'utf8');
  assert.doesNotMatch(source, /updateData\.employeeId\s*=/);
  assert.doesNotMatch(source, /data:\s*\{[\s\S]{0,240}\bemployeeId,/);
  assert.match(source, /ACCOUNT_BINDING_REQUIRES_DEDICATED_ENDPOINT/);
});
