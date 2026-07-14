import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(__dirname, '../../../..');
const repositoryRoot = path.resolve(projectRoot, '../..');

test('active Windows distribution surfaces contain no bootstrap credentials or SQLite claims', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const zipScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-zip.ps1'), 'utf8');
  const installer = fs.readFileSync(path.join(projectRoot, 'scripts', 'installer.iss'), 'utf8');

  assert.equal(manifest.scripts['build:installer'], 'cd scripts && build-installer.bat');
  assert.equal(manifest.scripts.installer, 'npm run build:installer');
  assert.doesNotMatch(zipScript, /admin\s*\/\s*123456/i);
  assert.doesNotMatch(installer, /sqlite/i);
});

test('Compose parameterizes PostgreSQL defaults, healthcheck, and test database initialization', () => {
  const compose = fs.readFileSync(path.join(projectRoot, 'infra', 'postgres', 'compose.yml'), 'utf8');
  const initializer = path.join(projectRoot, 'infra', 'postgres', 'init', '01-create-test-database.sh');

  assert.match(compose, /POSTGRES_DB: \$\{POSTGRES_DB:-chengye_oa\}/);
  assert.match(compose, /POSTGRES_USER: \$\{POSTGRES_USER:-chengye_app\}/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:-chengye_local_only\}/);
  assert.match(compose, /pg_isready -U \$\$\{POSTGRES_USER:-chengye_app\} -d \$\$\{POSTGRES_DB:-chengye_oa\}/);
  assert.equal(fs.existsSync(initializer), true);
  const initSource = fs.readFileSync(initializer, 'utf8');
  assert.match(initSource, /POSTGRES_TEST_DB.*chengye_oa_test/);
  assert.match(initSource, /POSTGRES_TEST_USER.*chengye_test/);
  assert.match(initSource, /POSTGRES_TEST_PASSWORD.*chengye_test_local_only/);
});

test('shell initializers are checked out with LF line endings', () => {
  const attributes = fs.readFileSync(path.join(repositoryRoot, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\*\.sh text eol=lf$/m);
});

test('backup rehearsal checks every native command and deployment docs use the repository runbook link', () => {
  const runbook = fs.readFileSync(path.join(repositoryRoot, 'docs', 'superpowers', 'runbooks', 'postgresql-backup-restore.md'), 'utf8');
  const deployment = fs.readFileSync(path.join(projectRoot, 'docs', 'DEPLOY.md'), 'utf8');
  const powerShellBlock = runbook.match(/```powershell\s+([\s\S]*?)```/)?.[1] ?? '';
  const nativeCommandLines = powerShellBlock.split(/\r?\n/).filter(line => /\b(?:docker|npm\.cmd)\b/.test(line));

  assert.match(powerShellBlock, /\$ErrorActionPreference\s*=\s*['"]Stop['"]/);
  assert.match(runbook, /function Invoke-CheckedCommand/);
  assert.equal(nativeCommandLines.length, 7);
  assert.ok(nativeCommandLines.every(line => line.trimStart().startsWith('Invoke-CheckedCommand')));
  assert.match(deployment, /\.\.\/\.\.\/\.\.\/docs\/superpowers\/runbooks\/postgresql-backup-restore\.md/);
});
