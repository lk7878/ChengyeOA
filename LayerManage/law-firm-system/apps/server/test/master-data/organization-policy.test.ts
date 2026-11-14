import assert from 'node:assert/strict';
import test from 'node:test';
import { canParent, isDescendantPath, rebasePath } from '../../app/domain/master-data/organization-policy';

test('allows only the approved administrative hierarchy', () => {
  assert.equal(canParent('FIRM', 'BRANCH'), true);
  assert.equal(canParent('FIRM', 'HQ_CENTER'), true);
  assert.equal(canParent('BRANCH', 'DEPARTMENT'), true);
  assert.equal(canParent('DEPARTMENT', 'GROUP'), true);
  assert.equal(canParent('BRANCH', 'BRANCH'), false);
  assert.equal(canParent('GROUP', 'DEPARTMENT'), false);
  assert.equal(canParent('FIRM', 'FIRM'), false);
});

test('recognizes strict descendants and rebases subtree paths', () => {
  assert.equal(isDescendantPath('/root/branch/department', '/root/branch'), true);
  assert.equal(isDescendantPath('/root/branch', '/root/branch'), false);
  assert.equal(isDescendantPath('/root/branch-office', '/root/branch'), false);
  assert.equal(rebasePath('/root/a', '/root/a/b/c', '/root/x'), '/root/x/b/c');
});
