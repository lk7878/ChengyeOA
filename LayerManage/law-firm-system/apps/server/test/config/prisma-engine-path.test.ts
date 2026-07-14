import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const requireCjs = createRequire(__filename);

const {
  materializePrismaQueryEngineLibrary,
  resolvePackagedPrismaQueryEngineLibrary,
  resolvePrismaQueryEngineLibrary,
} = requireCjs('../../scripts/lib/prisma-engine-path') as {
  materializePrismaQueryEngineLibrary: (clientDirectories: string[], executableDirectory: string) => string;
  resolvePackagedPrismaQueryEngineLibrary: (executablePath: string) => string;
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

test('materializes the generated Prisma engine beside the packaged executable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-engine-materialize-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clientDirectory = path.join(root, 'server', 'node_modules', '.prisma', 'client');
  const executableDirectory = path.join(root, 'portable');
  const source = path.join(clientDirectory, 'query_engine-windows.dll.node');
  fs.mkdirSync(clientDirectory, { recursive: true });
  fs.writeFileSync(source, 'generated native engine');

  const materialized = materializePrismaQueryEngineLibrary([clientDirectory], executableDirectory);

  assert.equal(materialized, path.join(executableDirectory, 'prisma-engine', 'query_engine-windows.dll.node'));
  assert.equal(fs.readFileSync(materialized, 'utf8'), 'generated native engine');
  assert.ok(fs.statSync(materialized).size > 0);
});

test('materialization fails when the generated Prisma engine is missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-engine-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => materializePrismaQueryEngineLibrary([path.join(root, 'generated-client')], path.join(root, 'portable')),
    /Generated Prisma query engine is missing or empty/,
  );
});

test('packaged runtime resolves exactly the materialized physical engine file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-engine-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executablePath = path.join(root, 'law-firm-system.exe');
  const enginePath = path.join(root, 'prisma-engine', 'query_engine-windows.dll.node');
  fs.mkdirSync(path.dirname(enginePath), { recursive: true });
  fs.writeFileSync(enginePath, 'physical native engine');

  assert.equal(resolvePackagedPrismaQueryEngineLibrary(executablePath), enginePath);
});

test('packaged runtime fails before startup when the physical engine is missing or empty', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-engine-runtime-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executablePath = path.join(root, 'law-firm-system.exe');
  const enginePath = path.join(root, 'prisma-engine', 'query_engine-windows.dll.node');

  assert.throws(() => resolvePackagedPrismaQueryEngineLibrary(executablePath), /Packaged Prisma query engine is missing or empty/);

  fs.mkdirSync(path.dirname(enginePath), { recursive: true });
  fs.writeFileSync(enginePath, '');
  assert.throws(() => resolvePackagedPrismaQueryEngineLibrary(executablePath), /Packaged Prisma query engine is missing or empty/);
});
