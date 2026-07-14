import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkBaselineContract } from '../../scripts/ci/check-baseline-contract';

test('repository exposes one Prisma source and no write bootstrap commands', () => {
  const projectRoot = path.resolve(__dirname, '../../../..');
  assert.deepEqual(checkBaselineContract(projectRoot), []);
});

function createProjectFixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-contract-'));
  const serverRoot = path.join(projectRoot, 'apps', 'server');
  fs.mkdirSync(path.join(serverRoot, 'prisma'), { recursive: true });
  fs.mkdirSync(path.join(serverRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.writeFileSync(path.join(serverRoot, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.writeFileSync(path.join(serverRoot, 'prisma', 'schema.prisma'), '');
  fs.writeFileSync(path.join(serverRoot, 'server-entry.js'), '');
  fs.writeFileSync(path.join(serverRoot, 'scripts', 'build-package.js'), '');
  return { projectRoot, serverRoot };
}

test('reports a duplicate Prisma schema and root seed command', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture.projectRoot, 'prisma'), { recursive: true });
  fs.writeFileSync(path.join(fixture.projectRoot, 'prisma', 'schema.prisma'), '');
  fs.writeFileSync(path.join(fixture.projectRoot, 'package.json'), JSON.stringify({ scripts: { seed: 'tsx scripts/seed.ts' } }));

  assert.deepEqual(checkBaselineContract(fixture.projectRoot), [
    'duplicate root Prisma schema exists',
    'seed command exists',
  ]);
});

test('reports generic seed scripts and server db:seed commands', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.serverRoot, 'scripts', 'seed.ts'), '');
  fs.writeFileSync(path.join(fixture.serverRoot, 'package.json'), JSON.stringify({ scripts: { 'db:seed': 'tsx scripts/seed.ts' } }));

  assert.deepEqual(checkBaselineContract(fixture.projectRoot), [
    'generic seed script exists',
    'db:seed command exists',
  ]);
});

test('reports package-level Prisma seed configuration in root and server manifests', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.projectRoot, 'package.json'), JSON.stringify({
    scripts: {},
    prisma: { seed: 'tsx scripts/bootstrap.ts' },
  }));
  fs.writeFileSync(path.join(fixture.serverRoot, 'package.json'), JSON.stringify({
    scripts: {},
    prisma: { seed: 'tsx scripts/bootstrap.ts' },
  }));

  assert.deepEqual(checkBaselineContract(fixture.projectRoot), [
    'root Prisma seed configuration exists',
    'server Prisma seed configuration exists',
  ]);
});

test('reports forbidden database fallback in server configuration', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture.serverRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(fixture.serverRoot, 'config', 'config.default.ts'), "const databaseUrl = 'file:./law_firm.db';");

  assert.deepEqual(checkBaselineContract(fixture.projectRoot), [
    'forbidden runtime pattern: file:',
    'forbidden runtime pattern: law_firm\\.db',
  ]);
});
