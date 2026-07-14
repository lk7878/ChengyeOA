import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(__dirname, '../../../..');
const repositoryRoot = path.resolve(projectRoot, '../..');

test('active Windows distribution surfaces contain no bootstrap credentials or SQLite claims', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const zipScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-zip.ps1'), 'utf8');
  const installerBuild = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-installer.bat'), 'utf8');
  const installer = fs.readFileSync(path.join(projectRoot, 'scripts', 'installer.iss'), 'utf8');

  assert.equal(manifest.scripts.pkg, 'npm --prefix apps/server run pkg');
  assert.equal(manifest.scripts.package, 'npm run pkg');
  assert.equal(manifest.scripts['build:installer'], 'cd scripts && build-installer.bat');
  assert.equal(manifest.scripts.installer, 'npm run build:installer');
  assert.match(zipScript, /\$sourceDir\s*=\s*Join-Path \$projectRoot ["']apps\\dist\\law-firm-system["']/);
  assert.match(zipScript, /\$outputDir\s*=\s*Join-Path \$projectRoot ["']apps\\dist\\installer["']/);
  assert.match(installer, /^OutputDir=\.\.\\apps\\dist\\installer$/m);
  assert.match(installer, /^Source: "\.\.\\apps\\dist\\law-firm-system\\\*";/m);
  assert.match(installerBuild, /npm\.cmd run pkg/i);
  assert.match(zipScript, /npm\.cmd run pkg/i);
  assert.match(installerBuild, /verify-package-output\.js/i);
  assert.match(zipScript, /verify-package-output\.js/i);
  assert.doesNotMatch(installerBuild, /build-package\.js|process\.execPath|launch\.bat/i);
  assert.doesNotMatch(zipScript, /build-package\.js|process\.execPath|launch\.bat/i);
  assert.doesNotMatch(zipScript, /admin\s*\/\s*123456/i);
  assert.doesNotMatch(installer, /sqlite/i);
});

test('Inno Setup installs, launches, shortcuts, and uninstalls the pkg executable target', () => {
  const installer = fs.readFileSync(path.join(projectRoot, 'scripts', 'installer.iss'), 'utf8');

  assert.match(installer, /^#define MyAppExeName "law-firm-system\.exe"$/m);
  assert.match(installer, /Name: "\{group\}\\\{#MyAppName\}"; Filename: "\{app\}\\\{#MyAppExeName\}";/);
  assert.match(installer, /Name: "\{commondesktop\}\\\{#MyAppName\}"; Filename: "\{app\}\\\{#MyAppExeName\}";/);
  assert.match(installer, /^Filename: "\{app\}\\\{#MyAppExeName\}";.*postinstall/m);
  assert.match(installer, /^Filename: "taskkill"; Parameters: "\/f \/im \{#MyAppExeName\}";/m);
  assert.doesNotMatch(installer, /launch\.bat|node\.exe|cmd\.exe/i);
});

test('ZIP builder fails fast and validates its output before reporting success', () => {
  const zipScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-zip.ps1'), 'utf8');

  assert.match(zipScript, /\$ErrorActionPreference\s*=\s*['"]Stop['"]/);
  assert.match(zipScript, /Test-Path\s+(?:-LiteralPath\s+)?\$zipFile/);
  assert.match(zipScript, /Get-Item\s+(?:-LiteralPath\s+)?\$zipFile/);
  assert.ok(zipScript.indexOf('Test-Path') < zipScript.indexOf('ZIP package created'));
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

test('PostgreSQL initializer is executable in the Git index', () => {
  const relativePath = 'LayerManage/law-firm-system/infra/postgres/init/01-create-test-database.sh';
  const stagedEntry = execFileSync('git', ['ls-files', '--stage', '--', relativePath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.match(stagedEntry, /^100755\s/);
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
