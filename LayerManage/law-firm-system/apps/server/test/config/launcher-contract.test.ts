import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const launchers = [
  fs.readFileSync(path.resolve('server-entry.js'), 'utf8'),
  fs.readFileSync(path.resolve('scripts/build-package.js'), 'utf8'),
];

test('portable launchers require validated external database and secret configuration', () => {
  assert.match(launchers[0], /require\(['"]\.\/dist\/config\/env['"]\)/);
  assert.match(launchers[1], /require\(['"]\.\/config\/env['"]\)/);

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

test('packaging cannot create SQLite or implicit bootstrap data', () => {
  const packageSource = fs.readFileSync(path.resolve('scripts/build-package.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(fs.existsSync(path.resolve('scripts/build-dist.js')), false);
  assert.equal(packageJson.scripts['build-dist'], undefined);
  assert.doesNotMatch(packageSource, /ensureDatabase|\$executeRawUnsafe|law_firm\.db|file:|admin\s*\/\s*123456/i);
  assert.doesNotMatch(packageSource, /organization\.create|user\.create|role\.create|Run seed|绉嶅瓙鏁版嵁/i);
});
