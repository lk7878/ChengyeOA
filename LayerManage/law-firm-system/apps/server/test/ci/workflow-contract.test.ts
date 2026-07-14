import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(__dirname, '../../../../../..');

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
  assert.doesNotMatch(config, /stopwords|paths\s*=/i);
});
