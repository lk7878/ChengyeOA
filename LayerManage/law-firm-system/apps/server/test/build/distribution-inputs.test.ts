import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface VerifiedPackageOutput {
  engineFile: string;
  executable: string;
  packageDirectory: string;
  publicDirectory: string;
  runDirectory: string;
}

type VerifyPackageOutput = (packageDirectory: string) => VerifiedPackageOutput;

const requireCjs = createRequire(__filename);

function loadVerifier(): VerifyPackageOutput {
  return (requireCjs('../../../../scripts/verify-package-output') as {
    verifyPackageOutput: VerifyPackageOutput;
  }).verifyPackageOutput;
}

function materializePackage(packageDirectory: string): void {
  fs.mkdirSync(path.join(packageDirectory, 'prisma-engine'), { recursive: true });
  fs.mkdirSync(path.join(packageDirectory, 'public'), { recursive: true });
  fs.mkdirSync(path.join(packageDirectory, 'run'), { recursive: true });
  fs.writeFileSync(path.join(packageDirectory, 'law-firm-system.exe'), 'fixture executable');
  fs.writeFileSync(path.join(packageDirectory, 'prisma-engine', 'query_engine-windows.dll.node'), 'fixture engine');
  fs.writeFileSync(path.join(packageDirectory, 'public', 'index.html'), '<!doctype html><title>fixture</title>');
  fs.writeFileSync(path.join(packageDirectory, 'run', '.keep'), 'runtime directory');
}

test('distribution verifier accepts only the pkg executable and physical runtime directories', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-dist-input-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const packageDirectory = path.join(root, 'law-firm-system');
  materializePackage(packageDirectory);

  const verified = loadVerifier()(packageDirectory);
  assert.equal(verified.executable, path.join(packageDirectory, 'law-firm-system.exe'));
  assert.equal(verified.engineFile, path.join(packageDirectory, 'prisma-engine', 'query_engine-windows.dll.node'));
  assert.equal(verified.publicDirectory, path.join(packageDirectory, 'public'));
  assert.equal(verified.runDirectory, path.join(packageDirectory, 'run'));

  fs.rmSync(verified.runDirectory, { recursive: true });
  fs.writeFileSync(verified.runDirectory, 'not a physical directory');
  assert.throws(() => loadVerifier()(packageDirectory), /run directory.*physical directory/i);
});

test('distribution verifier rejects forbidden extras anywhere in the package tree', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-dist-forbidden-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const packageDirectory = path.join(root, 'law-firm-system');
  materializePackage(packageDirectory);
  fs.writeFileSync(path.join(packageDirectory, 'public', 'credentials.json'), 'FORBIDDEN_ZIP_FIXTURE');

  assert.throws(
    () => loadVerifier()(packageDirectory),
    /Forbidden package artifacts: public[\\/]credentials\.json/,
  );
});

test('actual ZIP builder packages the verified npm run pkg tree', t => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-zip-input-'));
  t.after(() => fs.rmSync(projectRoot, { force: true, recursive: true }));
  const packageDirectory = path.join(projectRoot, 'apps', 'dist', 'law-firm-system');
  const materializer = path.join(projectRoot, 'materialize-package.js');
  fs.writeFileSync(materializer, [
    "const fs = require('fs');",
    "const path = require('path');",
    "const root = path.join(__dirname, 'apps', 'dist', 'law-firm-system');",
    "fs.mkdirSync(path.join(root, 'prisma-engine'), { recursive: true });",
    "fs.mkdirSync(path.join(root, 'public'), { recursive: true });",
    "fs.mkdirSync(path.join(root, 'run'), { recursive: true });",
    "fs.writeFileSync(path.join(root, 'law-firm-system.exe'), 'fixture executable');",
    "fs.writeFileSync(path.join(root, 'prisma-engine', 'query_engine-windows.dll.node'), 'fixture engine');",
    "fs.writeFileSync(path.join(root, 'public', 'index.html'), '<!doctype html><title>fixture</title>');",
    "fs.writeFileSync(path.join(root, 'run', '.keep'), 'runtime directory');",
  ].join('\n'));
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'distribution-fixture',
    private: true,
    scripts: { pkg: 'node materialize-package.js' },
  }));

  const zipScript = path.resolve('../..', 'scripts', 'build-zip.ps1');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', zipScript, '-ProjectRoot', projectRoot,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.statSync(path.join(packageDirectory, 'law-firm-system.exe')).isFile(), true);

  const zipFile = path.join(projectRoot, 'apps', 'dist', 'installer', 'LawFirmSystem-Portable-1.0.0.zip');
  const extracted = path.join(projectRoot, 'extracted');
  const quotePowerShell = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const expand = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Expand-Archive -LiteralPath ${quotePowerShell(zipFile)} -DestinationPath ${quotePowerShell(extracted)}`,
  ], { encoding: 'utf8' });
  assert.equal(expand.status, 0, expand.stderr || expand.stdout);
  assert.equal(fs.existsSync(path.join(extracted, 'law-firm-system.exe')), true);
  assert.equal(fs.existsSync(path.join(extracted, 'prisma-engine', 'query_engine-windows.dll.node')), true);
  assert.equal(fs.existsSync(path.join(extracted, 'public', 'index.html')), true);
  assert.equal(fs.statSync(path.join(extracted, 'run')).isDirectory(), true);
  assert.equal(fs.existsSync(path.join(extracted, 'launch.bat')), false);
});

test('actual ZIP builder rejects a forbidden pkg tree and cleans package/archive output', t => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-zip-forbidden-'));
  t.after(() => fs.rmSync(projectRoot, { force: true, recursive: true }));
  const packageDirectory = path.join(projectRoot, 'apps', 'dist', 'law-firm-system');
  fs.writeFileSync(path.join(projectRoot, 'materialize-package.js'), [
    "const fs = require('fs');",
    "const path = require('path');",
    "const root = path.join(__dirname, 'apps', 'dist', 'law-firm-system');",
    "fs.mkdirSync(path.join(root, 'prisma-engine'), { recursive: true });",
    "fs.mkdirSync(path.join(root, 'public'), { recursive: true });",
    "fs.mkdirSync(path.join(root, 'run'), { recursive: true });",
    "fs.writeFileSync(path.join(root, 'law-firm-system.exe'), 'fixture executable');",
    "fs.writeFileSync(path.join(root, 'prisma-engine', 'query_engine-windows.dll.node'), 'fixture engine');",
    "fs.writeFileSync(path.join(root, 'public', 'index.html'), '<!doctype html><title>fixture</title>');",
    "fs.writeFileSync(path.join(root, 'public', 'credentials.json'), 'FORBIDDEN_ZIP_FIXTURE');",
    "fs.writeFileSync(path.join(root, 'run', '.keep'), 'runtime directory');",
  ].join('\n'));
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'forbidden-distribution-fixture',
    private: true,
    scripts: { pkg: 'node materialize-package.js' },
  }));

  const zipScript = path.resolve('../..', 'scripts', 'build-zip.ps1');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', zipScript, '-ProjectRoot', projectRoot,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /Forbidden package artifacts: public[\\/]credentials\.json/);
  assert.equal(fs.existsSync(packageDirectory), false);
  assert.equal(
    fs.existsSync(path.join(projectRoot, 'apps', 'dist', 'installer', 'LawFirmSystem-Portable-1.0.0.zip')),
    false,
  );
});
