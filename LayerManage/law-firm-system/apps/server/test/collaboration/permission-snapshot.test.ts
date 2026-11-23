import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionSnapshot } from '../../app/application/collaboration/permission-snapshot';

test('unordered grants, records and field sets do not cause permission refreshes', () => {
  const first = {access:{rowIds:['b','a'],readonly:['f2','f1'],scopedRules:[{ids:new Set(['a','b'])}]}, grants:[{code:'read',scopeIds:['SELF','ORG']},{code:'edit'}]};
  const reordered = {grants:[{code:'edit'},{scopeIds:['ORG','SELF'],code:'read'}],access:{readonly:['f1','f2'],rowIds:['a','b'],scopedRules:[{ids:new Set(['b','a'])}]}};
  assert.equal(permissionSnapshot(first),permissionSnapshot(reordered));
  assert.notEqual(permissionSnapshot(first),permissionSnapshot({...first,grants:[{code:'read',scopeIds:['SELF','ORG']}]}));
  assert.notEqual(permissionSnapshot(first),permissionSnapshot({...first,access:{...first.access,rowIds:['a']}}));
  assert.notEqual(permissionSnapshot(first),permissionSnapshot({...first,access:{...first.access,scopedRules:[{ids:new Set(['a'])}]}}));
});
