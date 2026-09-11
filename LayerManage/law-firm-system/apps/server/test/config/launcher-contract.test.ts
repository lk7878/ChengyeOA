import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const launchers = [fs.readFileSync(path.resolve('server-entry.js'), 'utf8')];

test('portable launchers require validated external database and secret configuration', () => {
  assert.match(launchers[0], /require\(['"]\.\/dist\/config\/env['"]\)/);

  for (const source of launchers) {
    assert.match(source, /loadProductionEnvironment\(process\.env\)/);
    assert.ok(source.indexOf('loadProductionEnvironment(process.env)') < source.indexOf("require('egg')"));
    assert.doesNotMatch(source, /file:/);
    assert.doesNotMatch(source, /law_firm\.db/);
    assert.doesNotMatch(source, /Date\.now\(\)/);
    assert.doesNotMatch(source, /process\.env\.(?:DATABASE_URL|JWT_SECRET|APP_KEYS)\s*=/);
  }
});

test('pkg launcher resolves Prisma to an exact Windows native engine file', () => {
  const entrySource = launchers[0];

  assert.match(entrySource, /resolvePackagedPrismaQueryEngineLibrary\(process\.execPath\)/);
  assert.match(entrySource, /PRISMA_QUERY_ENGINE_LIBRARY\s*=\s*queryEngineLibrary/);
  assert.doesNotMatch(entrySource, /node_modules['"], ['"]\.prisma|__dirname[^\n]+\.prisma/);
  assert.ok(
    entrySource.indexOf('resolvePackagedPrismaQueryEngineLibrary(process.execPath)')
      < entrySource.indexOf('loadProductionEnvironment(process.env)'),
  );
});

test('pkg launcher does not forward its baked Node option to Egg workers', () => {
  const entrySource = launchers[0];
  const stripOption = "process.execArgv = process.execArgv.filter(arg => arg !== '--no-experimental-require-module')";

  assert.match(entrySource, /process\.execArgv\s*=\s*process\.execArgv\.filter/);
  assert.ok(entrySource.indexOf(stripOption) < entrySource.indexOf("require('egg')"));
});

test('portable launcher routes events:check to the compiled command under production validation', () => {
  const entrySource = launchers[0];

  assert.match(entrySource, /async function runCheck\(argv\)/);
  assert.match(entrySource, /require\(['"]\.\/dist\/scripts\/events\/check-events['"]\)/);
  assert.match(entrySource, /return checkEventsMain\(argv, process\.env\)/);
  assert.match(entrySource, /routePortableCommand\(argv,\s*\{[\s\S]*runCheck/);
  assert.match(entrySource, /module\.exports\s*=\s*\{[^}]*runCheck/);
  assert.ok(
    entrySource.indexOf("process.env.NODE_ENV = 'production'", entrySource.indexOf('async function runCheck(argv)'))
      < entrySource.indexOf("require('./dist/scripts/events/check-events')"),
  );
});

test('packaging cannot create SQLite or implicit bootstrap data', () => {
  const packageSource = [
    fs.readFileSync(path.resolve('scripts/build-pkg.js'), 'utf8'),
    fs.readFileSync(path.resolve('scripts/lib/pkg-build.js'), 'utf8'),
  ].join('\n');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(fs.existsSync(path.resolve('scripts/build-dist.js')), false);
  assert.equal(packageJson.scripts['build-dist'], undefined);
  assert.equal(fs.existsSync(path.resolve('scripts/build-package.js')), false);
  assert.doesNotMatch(packageSource, /ensureDatabase|\$executeRawUnsafe|law_firm\.db|file:|admin\s*\/\s*123456/i);
  assert.doesNotMatch(packageSource, /organization\.create|user\.create|role\.create|Run seed|绉嶅瓙鏁版嵁/i);
});

test('server has no legacy SQLite migration runtime or dependency', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert.equal(fs.existsSync(path.resolve('scripts/migration')), false);
  assert.equal(packageJson.scripts['migration:inventory'], undefined);
  assert.equal(packageJson.scripts['migration:diff'], undefined);
  assert.equal(packageJson.dependencies?.['better-sqlite3'], undefined);
  assert.equal(packageJson.devDependencies?.['better-sqlite3'], undefined);
  assert.equal(packageJson.devDependencies?.['@types/better-sqlite3'], undefined);
});
