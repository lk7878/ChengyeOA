import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { resolvePrismaQueryEngineLibrary } = require('../../scripts/lib/prisma-engine-path') as {
  resolvePrismaQueryEngineLibrary: (directories: string[]) => string | undefined;
};

test('resolves the exact Windows Prisma native engine file rather than its directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-engine-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clientDirectory = path.join(root, 'node_modules', '.prisma', 'client');
  const engineFile = path.join(clientDirectory, 'query_engine-windows.dll.node');
  fs.mkdirSync(clientDirectory, { recursive: true });
  fs.writeFileSync(engineFile, 'native engine fixture');

  assert.equal(resolvePrismaQueryEngineLibrary([clientDirectory]), engineFile);
});

test('ignores directories that do not contain a Windows Prisma native engine', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-engine-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(root, { recursive: true });

  assert.equal(resolvePrismaQueryEngineLibrary([root]), undefined);
});
