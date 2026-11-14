import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findDocumentationRoot,
  findPersistedDocumentationFiles,
  scanPersistedDocumentationContent,
} from '../../scripts/ci/check-persisted-documentation-leakage';

test('detects URL userinfo and sensitive environment assignments without echoing their values', () => {
  const unsafeUrl = ['postgresql://', 'local_user', ':', 'local_password', '@localhost:55432/example'].join('');
  const unsafeAssignment = ['JWT_', 'SECRET=', 'a'.repeat(32)].join('');
  const findings = scanPersistedDocumentationContent(`${unsafeUrl}\n${unsafeAssignment}\n`);

  assert.deepEqual(findings.map(finding => finding.rule), ['DATABASE_URL_USERINFO', 'SENSITIVE_ENV_ASSIGNMENT']);
  assert.deepEqual(findings.map(finding => finding.line), [1, 2]);
  assert.doesNotMatch(JSON.stringify(findings), /local_user|local_password|a{16}/);
});

test('detects known fixed test material by irreversible fingerprint and permits explicit redaction placeholders', () => {
  const knownMaterialWithoutLiteral = Array.from({ length: 32 }, (_, index) => String(index % 10)).join('');
  assert.deepEqual(
    scanPersistedDocumentationContent(`historical evidence: ${knownMaterialWithoutLiteral}`).map(item => item.rule),
    ['KNOWN_FIXED_TEST_MATERIAL'],
  );
  assert.deepEqual(scanPersistedDocumentationContent([
    "JWT_SECRET='<redacted local test value>'",
    'DATABASE_URL=<redacted local test URL>',
    'Use the JWT_SECRET, APP_KEYS, and MFA_ENCRYPTION_KEY_V1 environment variable names.',
  ].join('\n')), []);
});

test('all persisted SDD reports, closeout reports, and handoffs pass the documentation leakage scan', () => {
  const root = findDocumentationRoot();
  const files = findPersistedDocumentationFiles(root);
  assert.ok(files.some(file => file.relativePath.endsWith('task-2-report.md')));
  assert.ok(files.some(file => file.relativePath.includes('handoffs')));
  for (const file of files) {
    assert.deepEqual(scanPersistedDocumentationContent(file.content), [], file.relativePath);
  }
});
