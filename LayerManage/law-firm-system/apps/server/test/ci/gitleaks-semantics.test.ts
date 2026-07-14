import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

type SemanticFixtures = {
  allowedDirectory: string;
  detectedDirectory: string;
  root: string;
};

const fixtureModulePath = '../../scripts/ci/gitleaks-semantic-fixtures';

function loadFixtures() {
  return require(fixtureModulePath) as {
    documentedPlaceholders: string[];
    materializeGitleaksSemanticFixtures: () => SemanticFixtures;
    parseGitleaksAllowlistRegexes: (config: string) => RegExp[];
    prefixedAndSuffixedVariants: string[];
  };
}

test('parsed Gitleaks allowlist regexes match exact documented placeholders only', () => {
  const repositoryRoot = path.resolve(__dirname, '../../../../../..');
  const config = fs.readFileSync(path.join(repositoryRoot, '.gitleaks.toml'), 'utf8');
  const {
    documentedPlaceholders,
    parseGitleaksAllowlistRegexes,
    prefixedAndSuffixedVariants,
  } = loadFixtures();
  const regexes = parseGitleaksAllowlistRegexes(config);

  assert.deepEqual(documentedPlaceholders, [
    'chengye_local_only',
    'chengye_test_local_only',
    '01234567890123456789012345678901',
    'first-32-character-application-key',
    'second-32-character-app-key',
    'replace_with_at_least_32_random_characters',
    'replace_with_first_application_key',
    'replace_with_second_application_key',
  ]);
  for (const placeholder of documentedPlaceholders) {
    assert.equal(regexes.some(regex => regex.test(placeholder)), true, `exact placeholder is not allowed: ${placeholder}`);
  }
  for (const variant of prefixedAndSuffixedVariants) {
    assert.equal(regexes.some(regex => regex.test(variant)), false, `variant was over-allowed: ${variant}`);
  }
});

test('semantic fixture definitions materialize only in a temporary directory', (t) => {
  const {
    documentedPlaceholders,
    materializeGitleaksSemanticFixtures,
    prefixedAndSuffixedVariants,
  } = loadFixtures();
  const fixtures = materializeGitleaksSemanticFixtures();
  t.after(() => fs.rmSync(fixtures.root, { recursive: true, force: true }));

  assert.equal(fixtures.root.startsWith(path.resolve(os.tmpdir())), true);
  const allowed = fs.readFileSync(path.join(fixtures.allowedDirectory, 'placeholders.txt'), 'utf8');
  const detected = fs.readFileSync(path.join(fixtures.detectedDirectory, 'variants.txt'), 'utf8');
  for (const placeholder of documentedPlaceholders) assert.match(allowed, new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const variant of prefixedAndSuffixedVariants) assert.match(detected, new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const definitions = fs.readFileSync(require.resolve(fixtureModulePath), 'utf8');
  for (const variant of prefixedAndSuffixedVariants) assert.equal(definitions.includes(variant), false);
});
