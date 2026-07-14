import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveRunDirectory, resolveStaticDirectory } from '../../config/static-path';

test('packaged runtime selects a physical static directory beside the executable', () => {
  const snapshotBaseDir = 'C:\\snapshot\\server\\dist';
  const executable = 'D:\\portable\\law-firm-system.exe';

  const result = resolveStaticDirectory(snapshotBaseDir, { execPath: executable, pkg: {} });

  assert.equal(result, path.win32.join(path.win32.dirname(executable), 'public'));
  assert.equal(result.startsWith(snapshotBaseDir), false);
});

test('normal runtime keeps the existing baseDir public path', () => {
  const baseDir = path.join('workspace', 'apps', 'server');

  assert.equal(
    resolveStaticDirectory(baseDir, { execPath: process.execPath }),
    path.join(baseDir, 'public'),
  );
});

test('packaged runtime selects a physical run directory beside the executable', () => {
  const snapshotBaseDir = 'C:\\snapshot\\server\\dist';
  const executable = 'D:\\portable\\law-firm-system.exe';

  const result = resolveRunDirectory(snapshotBaseDir, { execPath: executable, pkg: {} });

  assert.equal(result, path.win32.join(path.win32.dirname(executable), 'run'));
  assert.equal(result.startsWith(snapshotBaseDir), false);
});

test('normal runtime keeps the existing baseDir run path', () => {
  const baseDir = path.join('workspace', 'apps', 'server');

  assert.equal(
    resolveRunDirectory(baseDir, { execPath: process.execPath }),
    path.join(baseDir, 'run'),
  );
});
