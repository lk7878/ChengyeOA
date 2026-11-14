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
  fs.mkdirSync(path.join(projectRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'infra', 'postgres', 'init'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.writeFileSync(path.join(serverRoot, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.writeFileSync(path.join(serverRoot, 'prisma', 'schema.prisma'), [
    'model Employee {',
    '  id String @id',
    '  assignments EmployeeAssignment[]',
    '}',
    ...Array.from({ length: 111 }, (_, index) => `model ContractModel${index + 1} { id String @id }`),
  ].join('\n'));
  fs.writeFileSync(path.join(serverRoot, 'server-entry.js'), '');
  fs.writeFileSync(path.join(serverRoot, 'scripts', 'build-pkg.js'), '');
  fs.writeFileSync(path.join(serverRoot, 'scripts', 'build.js'), '');
  fs.writeFileSync(path.join(projectRoot, 'scripts', 'build-zip.ps1'), '');
  fs.writeFileSync(path.join(projectRoot, 'scripts', 'installer.iss'), '');
  fs.writeFileSync(path.join(projectRoot, 'docs', 'api-spec.md'), 'PostgreSQL 16 external DATABASE_URL; prisma migrate deploy; empty baseline.');
  fs.writeFileSync(path.join(projectRoot, 'infra', 'postgres', 'compose.yml'), [
    'POSTGRES_DB: ${POSTGRES_DB:-chengye_oa}',
    'POSTGRES_USER: ${POSTGRES_USER:-chengye_app}',
    'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-chengye_local_only}',
    'pg_isready -U $${POSTGRES_USER:-chengye_app} -d $${POSTGRES_DB:-chengye_oa}',
  ].join('\n'));
  fs.writeFileSync(path.join(projectRoot, 'infra', 'postgres', 'init', '01-create-test-database.sh'), [
    ': "${POSTGRES_TEST_DB:=chengye_oa_test}"',
    ': "${POSTGRES_TEST_USER:=chengye_test}"',
    ': "${POSTGRES_TEST_PASSWORD:=chengye_test_local_only}"',
  ].join('\n'));
  return { projectRoot, serverRoot };
}

test('reports a non-canonical model count and direct employee ownership fields', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.serverRoot, 'prisma', 'schema.prisma'), [
    'model Employee {',
    '  id String @id',
    '  orgId String',
    '  positionId String',
    '}',
  ].join('\n'));

  assert.deepEqual(checkBaselineContract(fixture.projectRoot), [
    'canonical Prisma model count is 1; expected 112',
    'Employee retains direct organization ownership fields',
    'canonical Prisma migration count is 0; expected 70',
  ]);
});

test('reports a duplicate Prisma schema and root seed command', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture.projectRoot, 'prisma'), { recursive: true });
  fs.writeFileSync(path.join(fixture.projectRoot, 'prisma', 'schema.prisma'), '');
  fs.writeFileSync(path.join(fixture.projectRoot, 'package.json'), JSON.stringify({ scripts: { seed: 'tsx scripts/seed.ts' } }));

  assert.deepEqual(checkBaselineContract(fixture.projectRoot), [
    'duplicate root Prisma schema exists',
    'canonical Prisma migration count is 0; expected 70',
    'seed command exists',
  ]);
});

test('reports generic seed scripts and server db:seed commands', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.serverRoot, 'scripts', 'seed.ts'), '');
  fs.writeFileSync(path.join(fixture.serverRoot, 'package.json'), JSON.stringify({ scripts: { 'db:seed': 'tsx scripts/seed.ts' } }));

  assert.deepEqual(checkBaselineContract(fixture.projectRoot), [
    'canonical Prisma migration count is 0; expected 70',
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
    'canonical Prisma migration count is 0; expected 70',
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
    'canonical Prisma migration count is 0; expected 70',
    'forbidden runtime pattern: file:',
    'forbidden runtime pattern: law_firm\\.db',
  ]);
});

test('reports active SQLite runtime guidance in API documentation', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.projectRoot, 'docs', 'api-spec.md'), [
    'Runtime database: SQLite 3',
    'DATABASE_URL=file:./dev.db',
  ].join('\n'));

  assert.deepEqual(checkBaselineContract(fixture.projectRoot), [
    'canonical Prisma migration count is 0; expected 70',
    'active SQLite runtime documentation exists: docs/api-spec.md',
  ]);
});

test('reports the correct Chinese seed-data phrase in runtime sources', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.serverRoot, 'server-entry.js'), '启动时写入种子数据');

  assert.deepEqual(checkBaselineContract(fixture.projectRoot), [
    'canonical Prisma migration count is 0; expected 70',
    'forbidden runtime pattern: 种子数据',
  ]);
});

test('reports unsafe project packaging scripts and broad build asset inputs', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.projectRoot, 'scripts', 'build-zip.ps1'), 'Login: admin / 123456');
  fs.writeFileSync(path.join(fixture.projectRoot, 'scripts', 'installer.iss'), '; SQLite needs write access');
  fs.writeFileSync(path.join(fixture.serverRoot, 'scripts', 'build.js'), "const copies = [['.env', '.env']];");
  fs.writeFileSync(path.join(fixture.serverRoot, 'package.json'), JSON.stringify({
    scripts: {},
    pkg: { assets: ['dist/**/*', 'config/credentials.json'] },
  }));

  const issues = checkBaselineContract(fixture.projectRoot);
  assert.ok(issues.includes('forbidden packaging pattern: admin\\s*\\/\\s*123456'));
  assert.ok(issues.includes('forbidden packaging pattern: sqlite'));
  assert.ok(issues.includes('broad package asset input exists: dist/**/*'));
  assert.ok(issues.includes('forbidden package asset input: config/credentials.json'));
  assert.ok(issues.includes('environment file build input exists'));
});

test('reports environment or credential files in build outputs', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture.serverRoot, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(fixture.projectRoot, 'apps', 'dist', 'law-firm-system'), { recursive: true });
  fs.writeFileSync(path.join(fixture.serverRoot, 'dist', '.env.production'), 'secret');
  fs.writeFileSync(path.join(fixture.projectRoot, 'apps', 'dist', 'law-firm-system', 'credentials.json'), '{}');

  const issues = checkBaselineContract(fixture.projectRoot);
  assert.ok(issues.some(issue => issue.includes('forbidden build artifact: apps/server/dist/.env.production')));
  assert.ok(issues.some(issue => issue.includes('forbidden build artifact: apps/dist/law-firm-system/credentials.json')));
});

test('reports unparameterized PostgreSQL compose and test database initialization', (t) => {
  const fixture = createProjectFixture();
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.projectRoot, 'infra', 'postgres', 'compose.yml'), [
    'POSTGRES_DB: chengye_oa',
    'POSTGRES_USER: chengye_app',
    'POSTGRES_PASSWORD: chengye_local_only',
    'pg_isready -U chengye_app -d chengye_oa',
  ].join('\n'));
  fs.rmSync(path.join(fixture.projectRoot, 'infra', 'postgres', 'init'), { recursive: true, force: true });

  const issues = checkBaselineContract(fixture.projectRoot);
  assert.ok(issues.includes('Compose POSTGRES_DB is not parameterized'));
  assert.ok(issues.includes('Compose POSTGRES_USER is not parameterized'));
  assert.ok(issues.includes('Compose POSTGRES_PASSWORD is not parameterized'));
  assert.ok(issues.includes('Compose healthcheck is not parameterized'));
  assert.ok(issues.includes('test database initializer is not parameterized'));
});
