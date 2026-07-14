import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const projectRoot = path.join(repositoryRoot, 'LayerManage', 'law-firm-system');

test('Node baseline supports the locked toolchain and stays aligned across CI metadata', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const nvmVersion = fs.readFileSync(path.join(repositoryRoot, '.nvmrc'), 'utf8').trim();
  const rootManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const rootLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const serverManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps', 'server', 'package.json'), 'utf8'));
  const serverLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps', 'server', 'package-lock.json'), 'utf8'));
  const webManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps', 'web', 'package.json'), 'utf8'));
  const webLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps', 'web', 'package-lock.json'), 'utf8'));

  assert.equal(nvmVersion, '22.14.0');
  assert.equal(rootManifest.engines.node, '>=22.14.0 <23');
  assert.equal(rootLock.packages[''].engines.node, rootManifest.engines.node);
  assert.equal(serverManifest.engines.node, rootManifest.engines.node);
  assert.equal(serverLock.packages[''].engines.node, serverManifest.engines.node);
  assert.equal(webManifest.engines.node, rootManifest.engines.node);
  assert.equal(webLock.packages[''].engines.node, webManifest.engines.node);
  assert.match(workflow, /node-version: '22\.14\.0'/);
});

test('CI compares the migrated PostgreSQL database with the canonical Prisma schema', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /working-directory: LayerManage\/law-firm-system\/apps\/server\s+run: npx prisma migrate diff --from-url "\$DATABASE_URL" --to-schema-datamodel prisma\/schema\.prisma --exit-code/);
});

test('CI runs Gitleaks from an immutable scanner image with repository config', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const config = fs.readFileSync(path.join(repositoryRoot, '.gitleaks.toml'), 'utf8');
  assert.match(workflow, /ghcr\.io\/gitleaks\/gitleaks:v8\.30\.1@sha256:[0-9a-f]{64}/);
  assert.match(workflow, /detect --source=\/repo --config=\/repo\/\.gitleaks\.toml --no-banner --redact --no-git/);
  assert.match(config, /SPEC-001 documented local and CI placeholders/);
  assert.match(config, /useDefault = true/);
  assert.match(config, /regexTarget\s*=\s*['"]secret['"]/);
  for (const placeholder of [
    'chengye_local_only',
    'chengye_test_local_only',
    '01234567890123456789012345678901',
    'first-32-character-application-key',
    'second-32-character-app-key',
    'replace_with_at_least_32_random_characters',
    'replace_with_first_application_key',
    'replace_with_second_application_key',
  ]) {
    assert.match(config, new RegExp(`\\^${placeholder}\\$`));
  }
  assert.doesNotMatch(config, /stopwords|paths\s*=/i);
});

test('CI runs the pinned-image Gitleaks semantic fixtures without weakening the repository scan', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const semanticScript = fs.readFileSync(path.resolve('scripts/ci/check-gitleaks-semantics.js'), 'utf8');

  assert.equal(manifest.scripts['check:gitleaks-semantics'], 'node scripts/ci/check-gitleaks-semantics.js');
  assert.match(workflow, /name: Prove Gitleaks placeholder semantics[\s\S]*npm --prefix LayerManage\/law-firm-system\/apps\/server run check:gitleaks-semantics/);
  assert.match(semanticScript, /ghcr\.io\/gitleaks\/gitleaks:v8\.30\.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f/);
  assert.match(semanticScript, /allowed[^\n]+status[^\n]+===?\s*0|status[^\n]+!==?\s*0/);
  assert.match(semanticScript, /detected[^\n]+status[^\n]+===?\s*1|status[^\n]+!==?\s*1/);
  assert.equal((workflow.match(/detect --source=\/repo --config=\/repo\/\.gitleaks\.toml --no-banner --redact --no-git/g) ?? []).length, 1);
});
