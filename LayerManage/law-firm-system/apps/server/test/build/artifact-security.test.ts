import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cleanBuildOutputs,
  copyBuildAssets,
  findForbiddenArtifacts,
} from '../../scripts/lib/build-artifacts';

function createServerFixture(): string {
  const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'build-artifacts-'));
  fs.mkdirSync(path.join(serverRoot, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(serverRoot, 'public'), { recursive: true });
  fs.mkdirSync(path.join(serverRoot, 'prisma', 'migrations', 'baseline'), { recursive: true });
  fs.writeFileSync(path.join(serverRoot, 'package.json'), JSON.stringify({ name: 'fixture' }));
  fs.writeFileSync(path.join(serverRoot, 'public', 'index.html'), '<main>fixture</main>');
  fs.writeFileSync(path.join(serverRoot, 'prisma', 'schema.prisma'), 'datasource db {}');
  fs.writeFileSync(path.join(serverRoot, 'prisma', 'migrations', 'baseline', 'migration.sql'), 'SELECT 1;');
  return serverRoot;
}

test('purges stale backend and portable output before packaging', (t) => {
  const serverRoot = createServerFixture();
  const packageOutput = path.join(serverRoot, '..', `${path.basename(serverRoot)}-portable`);
  t.after(() => {
    fs.rmSync(serverRoot, { recursive: true, force: true });
    fs.rmSync(packageOutput, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(serverRoot, 'dist', '.env'), 'DATABASE_URL=secret');
  fs.mkdirSync(packageOutput, { recursive: true });
  fs.writeFileSync(path.join(packageOutput, 'credentials.json'), '{}');

  cleanBuildOutputs(serverRoot, packageOutput);

  assert.equal(fs.existsSync(path.join(serverRoot, 'dist')), false);
  assert.equal(fs.existsSync(packageOutput), false);
});

test('copies only allowlisted assets and cannot emit environment files', (t) => {
  const serverRoot = createServerFixture();
  t.after(() => fs.rmSync(serverRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(serverRoot, '.env'), 'DATABASE_URL=secret');

  copyBuildAssets(serverRoot);

  assert.equal(fs.existsSync(path.join(serverRoot, 'dist', 'public', 'index.html')), true);
  assert.equal(fs.existsSync(path.join(serverRoot, 'dist', 'prisma', 'schema.prisma')), true);
  assert.equal(fs.existsSync(path.join(serverRoot, 'dist', '.env')), false);
  assert.deepEqual(findForbiddenArtifacts(path.join(serverRoot, 'dist')), []);
});

test('pkg entrypoint cleans stale inputs and output before rebuilding', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const pkgBuilder = fs.readFileSync(path.resolve('scripts', 'build-pkg.js'), 'utf8');

  assert.equal(manifest.scripts.pkg, 'node scripts/build-pkg.js');
  assert.match(pkgBuilder, /cleanBuildOutputs/);
  assert.match(pkgBuilder, /execSync\('npm run build'/);
  assert.match(pkgBuilder, /execSync\('pkg \./);
  assert.ok(pkgBuilder.indexOf('cleanBuildOutputs') < pkgBuilder.indexOf("execSync('npm run build'"));
  assert.ok(pkgBuilder.indexOf("execSync('npm run build'") < pkgBuilder.indexOf("execSync('pkg ."));
});

test('pkg entrypoint removes the complete package output directory', () => {
  const pkgBuilder = fs.readFileSync(path.resolve('scripts', 'build-pkg.js'), 'utf8');

  assert.match(pkgBuilder, /const outputDir = path\.join\(serverRoot, '\.\.', 'dist'\)/);
  assert.match(pkgBuilder, /const outputFile = path\.join\(outputDir, 'law-firm-system\.exe'\)/);
  assert.match(pkgBuilder, /cleanBuildOutputs\(serverRoot, outputDir\)/);
});
