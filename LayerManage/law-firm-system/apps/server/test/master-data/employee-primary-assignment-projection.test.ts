import assert from 'node:assert/strict';
import test from 'node:test';
import { projectEmployeeWithPrimaryAssignment } from '../../app/application/master-data/employee-projection';

test('projects canonical primary assignment and removes legacy ownership fields', () => {
  const projected = projectEmployeeWithPrimaryAssignment({
    id: 'employee-1',
    employeeNo: 'EMP-001',
    name: 'Employee',
    orgId: 'legacy-org',
    positionId: 'legacy-position',
    assignments: [{
      id: 'assignment-1',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      positionId: 'position-1',
      assignmentType: 'PRIMARY',
      startedAt: new Date('2026-01-01'),
      endedAt: null,
      version: 1,
      organization: { id: 'org-1', code: 'ORG', name: 'Organization' },
      position: { id: 'position-1', code: 'LAWYER', name: 'Lawyer' },
    }],
  });

  assert.equal('orgId' in projected, false);
  assert.equal('positionId' in projected, false);
  assert.equal('assignments' in projected, false);
  assert.deepEqual(projected.primaryAssignment, {
    id: 'assignment-1',
    employeeId: 'employee-1',
    organizationId: 'org-1',
    positionId: 'position-1',
    assignmentType: 'PRIMARY',
    startedAt: new Date('2026-01-01'),
    endedAt: null,
    version: 1,
    organization: { id: 'org-1', code: 'ORG', name: 'Organization' },
    position: { id: 'position-1', code: 'LAWYER', name: 'Lawyer' },
  });
});
