import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { executeSecurityCommand, parseCommandArguments } from './cli.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const clean = readFileSync(path.join(projectRoot, 'scripts/security/fixtures/clean.json'), 'utf8');

test('parses only supported command and workspace arguments', () => {
  assert.deepEqual(parseCommandArguments(['audit-prod', '--workspace', 'web']), {
    command: 'audit-prod', workspace: 'web',
  });
  assert.deepEqual(parseCommandArguments(['sbom']), { command: 'sbom' });
  assert.deepEqual(parseCommandArguments(['audit-exceptions']), { command: 'audit-exceptions' });
  assert.deepEqual(
    parseCommandArguments(['audit-exceptions', 'approve', 'SEC-X', '--reviewed-by', 'reviewer']),
    { command: 'audit-exceptions', action: 'approve', id: 'SEC-X', reviewedBy: 'reviewer' },
  );
  assert.deepEqual(parseCommandArguments(['audit-exceptions', 'reject', 'SEC-X']), {
    command: 'audit-exceptions', action: 'reject', id: 'SEC-X',
  });
  assert.throws(() => parseCommandArguments(['audit-exceptions', 'approve', 'SEC-X']), /approve <id> --reviewed-by/);
  assert.throws(() => parseCommandArguments(['audit-exceptions', 'reject']), /reject <id>/);
  assert.throws(() => parseCommandArguments(['audit-exceptions', 'bogus']), /approve or reject/);
  assert.throws(() => parseCommandArguments(['audit-prod', '--workspace', 'desktop']), /workspace/i);
  assert.throws(() => parseCommandArguments(['audit-all', '--workspace', 'web', '--workspace', 'server']), /arguments/i);
  assert.throws(() => parseCommandArguments(['unknown']), /unsupported/i);
});

test('runs a production audit for only the selected workspace', () => {
  const calls = [];
  const written = [];
  const result = executeSecurityCommand(['audit-prod', '--workspace', 'web'], {
    projectRoot,
    now: new Date('2026-07-30T00:00:00Z'),
    runNpm: (args, options) => {
      calls.push({ args, cwd: options.cwd });
      return args[0] === '--version'
        ? { status: 0, stdout: '10.9.2\n', stderr: '' }
        : { status: 0, stdout: clean, stderr: '' };
    },
    runCommand: () => ({ status: 0, stdout: '0123456789abcdef\n', stderr: '' }),
    writeAuditSummary: (...args) => { written.push(args); return 'summary.json'; },
    writeSbom: () => { throw new Error('SBOM must not run'); },
    stdout: { write() {} },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.filter(call => call.args[0] === 'audit').length, 1);
  assert.match(calls.find(call => call.args[0] === 'audit').cwd.replaceAll('\\', '/'), /apps\/web$/);
  assert.equal(written[0][1], 'production');
  assert.equal(written[0][2].length, 1);
});

test('runs production and full reports for both workspaces', () => {
  const auditCalls = [];
  const result = executeSecurityCommand(['audit-all'], {
    projectRoot,
    now: new Date('2026-07-30T00:00:00Z'),
    runNpm: (args, options) => {
      if (args[0] === 'audit') auditCalls.push({ args, cwd: options.cwd });
      return args[0] === '--version'
        ? { status: 0, stdout: '10.9.2\n', stderr: '' }
        : { status: 0, stdout: clean, stderr: '' };
    },
    runCommand: () => ({ status: 0, stdout: '0123456789abcdef\n', stderr: '' }),
    writeAuditSummary: () => 'summary.json',
    writeSbom: () => { throw new Error('SBOM must not run'); },
    stdout: { write() {} },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(auditCalls.length, 4);
  assert.equal(auditCalls.filter(call => call.args.includes('--omit=dev')).length, 2);
});

test('generates separate SBOMs for server and web', () => {
  const written = [];
  const sbom = JSON.stringify({
    bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, metadata: {}, components: [],
  });
  const result = executeSecurityCommand(['sbom'], {
    projectRoot,
    now: new Date('2026-07-30T00:00:00Z'),
    runNpm: args => args[0] === '--version'
      ? { status: 0, stdout: '10.9.2\n', stderr: '' }
      : { status: 0, stdout: sbom, stderr: '' },
    runCommand: () => ({ status: 0, stdout: '0123456789abcdef\n', stderr: '' }),
    writeAuditSummary: () => { throw new Error('audit must not run'); },
    writeSbom: (_output, workspace) => { written.push(workspace); return `${workspace}.json`; },
    stdout: { write() {} },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(written, ['server', 'web']);
});

function exceptionFixture(entries) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sec-exc-'));
  const securityDir = path.join(dir, 'security');
  mkdirSync(securityDir, { recursive: true });
  writeFileSync(path.join(securityDir, 'dependency-exceptions.json'), JSON.stringify({ schemaVersion: 1, exceptions: entries }));
  writeFileSync(path.join(securityDir, 'dependency-policy.json'), JSON.stringify({
    schemaVersion: 1,
    workspaces: [{ name: 'server', path: 'apps/server' }, { name: 'web', path: 'apps/web' }],
    gates: {
      production: { critical: 'block', high: 'block', moderate: 'block', low: 'report' },
      development: { critical: 'block', high: 'exception', moderate: 'report', low: 'report' },
    },
    maxDevelopmentExceptionDays: 30,
    outputDirectory: 'var/security',
  }));
  mkdirSync(path.join(dir, 'scripts/security'), { recursive: true });
  writeFileSync(path.join(dir, 'scripts/security/expected-baseline.json'), JSON.stringify({
    server: {
      production: { critical: 0, high: 0, moderate: 0, low: 0 },
      development: { critical: 0, high: 0, moderate: 0, low: 0 },
    },
    web: {
      production: { critical: 0, high: 0, moderate: 0, low: 0 },
      development: { critical: 0, high: 0, moderate: 0, low: 0 },
    },
  }));
  return dir;
}

const EXCEPTION_ENTRY = {
  workspace: 'server',
  package: 'serialize-javascript',
  advisories: ['GHSA-5c6j-r48x-rmvq'],
  scope: 'development',
  reason: 'No compatible upstream release is available.',
  mitigation: 'The package is restricted to isolated development execution.',
  owner: 'platform-engineering',
  approvedBy: 'system-super-admin',
  createdAt: '2026-07-16',
  expiresAt: '2026-08-15',
  trackingRef: 'SEC-SPEC-001/serialize-javascript',
};

test('reports audit exceptions by status with expiry warnings', () => {
  const dir = exceptionFixture([
    { id: 'SEC-APPROVED', status: 'approved', ...EXCEPTION_ENTRY, expiresAt: '2026-08-05' },
    { id: 'SEC-PENDING', status: 'pending_review', ...EXCEPTION_ENTRY },
    { id: 'SEC-LEGACY', ...EXCEPTION_ENTRY, expiresAt: '2026-07-30' },
    { id: 'SEC-BAD', status: 'archived', ...EXCEPTION_ENTRY },
  ]);
  try {
    const written = [];
    const result = executeSecurityCommand(['audit-exceptions'], {
      projectRoot: dir,
      now: new Date('2026-08-05T00:00:00Z'),
      stdout: { write(text) { written.push(text); } },
    });
    assert.equal(result.exitCode, 0);
    const output = written.join('');
    assert.match(output, /approved \(1\): SEC-APPROVED/);
    assert.match(output, /pending_review \(1\): SEC-PENDING/);
    assert.match(output, /expired \(1\): SEC-LEGACY/);
    assert.match(output, /invalid \(1\): SEC-BAD/);
    assert.match(output, /expiring_soon .*SEC-APPROVED expires 2026-08-05/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tolerates a missing or malformed exceptions file in the report', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sec-exc-'));
  try {
    const first = [];
    const missing = executeSecurityCommand(['audit-exceptions'], {
      projectRoot: dir,
      now: new Date('2026-08-05T00:00:00Z'),
      stdout: { write(text) { first.push(text); } },
    });
    assert.equal(missing.exitCode, 0);
    assert.match(first.join(''), /missing/);

    const securityDir = path.join(dir, 'security');
    mkdirSync(securityDir, { recursive: true });
    writeFileSync(path.join(securityDir, 'dependency-exceptions.json'), '{not json');
    const second = [];
    const malformed = executeSecurityCommand(['audit-exceptions'], {
      projectRoot: dir,
      now: new Date('2026-08-05T00:00:00Z'),
      stdout: { write(text) { second.push(text); } },
    });
    assert.equal(malformed.exitCode, 0);
    assert.match(second.join(''), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports malformed entries as invalid and expired pending entries in both buckets', () => {
  const dir = exceptionFixture([
    { id: 'SEC-NOFIELDS', status: 'approved' },
    { id: 'SEC-BADDATE', status: 'approved', ...EXCEPTION_ENTRY, expiresAt: '2026-13-99' },
    { id: 'SEC-PENDEXP', status: 'pending_review', ...EXCEPTION_ENTRY, expiresAt: '2026-07-30' },
  ]);
  try {
    const written = [];
    const result = executeSecurityCommand(['audit-exceptions'], {
      projectRoot: dir,
      now: new Date('2026-08-05T00:00:00Z'),
      stdout: { write(text) { written.push(text); } },
    });
    assert.equal(result.exitCode, 0);
    const output = written.join('');
    assert.match(output, /invalid \(2\): SEC-NOFIELDS, SEC-BADDATE/);
    assert.match(output, /pending_review \(1\): SEC-PENDEXP/);
    assert.match(output, /expired \(1\): SEC-PENDEXP/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tolerates a non-array exceptions document in the report', () => {
  const dir = exceptionFixture('not-an-array');
  try {
    const written = [];
    const result = executeSecurityCommand(['audit-exceptions'], {
      projectRoot: dir,
      now: new Date('2026-08-05T00:00:00Z'),
      stdout: { write(text) { written.push(text); } },
    });
    assert.equal(result.exitCode, 0);
    const output = written.join('');
    assert.match(output, /approved \(0\): none/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('approves a pending exception with review metadata', () => {
  const dir = exceptionFixture([{ id: 'SEC-PENDING', status: 'pending_review', ...EXCEPTION_ENTRY }]);
  try {
    const written = [];
    const result = executeSecurityCommand(
      ['audit-exceptions', 'approve', 'SEC-PENDING', '--reviewed-by', 'platform-reviewer'],
      { projectRoot: dir, now: new Date('2026-08-05T00:00:00Z'), stdout: { write(text) { written.push(text); } } },
    );
    assert.equal(result.exitCode, 0);
    assert.match(written.join(''), /approved SEC-PENDING by platform-reviewer on 2026-08-05/);
    const saved = JSON.parse(readFileSync(path.join(dir, 'security/dependency-exceptions.json'), 'utf8'));
    assert.equal(saved.exceptions[0].status, 'approved');
    assert.equal(saved.exceptions[0].approvedBy, 'platform-reviewer');
    assert.equal(saved.exceptions[0].reviewedAt, '2026-08-05');
    assert.equal(saved.exceptions[0].reviewedBy, 'platform-reviewer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('is idempotent when approving an already approved exception', () => {
  const dir = exceptionFixture([{ id: 'SEC-APPROVED', status: 'approved', ...EXCEPTION_ENTRY }]);
  try {
    const written = [];
    const result = executeSecurityCommand(
      ['audit-exceptions', 'approve', 'SEC-APPROVED', '--reviewed-by', 'platform-reviewer'],
      { projectRoot: dir, now: new Date('2026-08-05T00:00:00Z'), stdout: { write(text) { written.push(text); } } },
    );
    assert.equal(result.exitCode, 0);
    assert.match(written.join(''), /already approved/);
    const saved = JSON.parse(readFileSync(path.join(dir, 'security/dependency-exceptions.json'), 'utf8'));
    assert.equal(saved.exceptions[0].reviewedAt, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects self-approval where the reviewer is the owner', () => {
  const dir = exceptionFixture([{ id: 'SEC-PENDING', status: 'pending_review', ...EXCEPTION_ENTRY }]);
  try {
    assert.throws(
      () => executeSecurityCommand(
        ['audit-exceptions', 'approve', 'SEC-PENDING', '--reviewed-by', 'platform-engineering'],
        { projectRoot: dir, now: new Date('2026-08-05T00:00:00Z'), stdout: { write() {} } },
      ),
      /reviewer must differ from exception owner/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removes an exception when rejected', () => {
  const dir = exceptionFixture([
    { id: 'SEC-APPROVED', status: 'approved', ...EXCEPTION_ENTRY },
    { id: 'SEC-PENDING', status: 'pending_review', ...EXCEPTION_ENTRY },
  ]);
  try {
    const written = [];
    const result = executeSecurityCommand(['audit-exceptions', 'reject', 'SEC-PENDING'], {
      projectRoot: dir, now: new Date('2026-08-05T00:00:00Z'), stdout: { write(text) { written.push(text); } },
    });
    assert.equal(result.exitCode, 0);
    assert.match(written.join(''), /rejected SEC-PENDING/);
    const saved = JSON.parse(readFileSync(path.join(dir, 'security/dependency-exceptions.json'), 'utf8'));
    assert.deepEqual(saved.exceptions.map(item => item.id), ['SEC-APPROVED']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fails to approve or reject a missing exception id', () => {
  const dir = exceptionFixture([]);
  try {
    assert.throws(
      () => executeSecurityCommand(
        ['audit-exceptions', 'approve', 'SEC-MISSING', '--reviewed-by', 'reviewer'],
        { projectRoot: dir, now: new Date('2026-08-05T00:00:00Z'), stdout: { write() {} } },
      ),
      /not found/,
    );
    assert.throws(
      () => executeSecurityCommand(['audit-exceptions', 'reject', 'SEC-MISSING'], {
        projectRoot: dir, now: new Date('2026-08-05T00:00:00Z'), stdout: { write() {} },
      }),
      /not found/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trims whitespace from the reviewer name when approving', () => {
  const dir = exceptionFixture([{ id: 'SEC-PENDING', status: 'pending_review', ...EXCEPTION_ENTRY }]);
  try {
    const result = executeSecurityCommand(
      ['audit-exceptions', 'approve', 'SEC-PENDING', '--reviewed-by', '  reviewer-name  '],
      { projectRoot: dir, now: new Date('2026-08-05T00:00:00Z'), stdout: { write() {} } },
    );
    assert.equal(result.exitCode, 0);
    const saved = JSON.parse(readFileSync(path.join(dir, 'security/dependency-exceptions.json'), 'utf8'));
    assert.equal(saved.exceptions[0].reviewedBy, 'reviewer-name');
    assert.equal(saved.exceptions[0].approvedBy, 'reviewer-name');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an expired exception that strict validation would refuse', () => {
  const dir = exceptionFixture([{ id: 'SEC-EXPIRED', status: 'pending_review', ...EXCEPTION_ENTRY, expiresAt: '2026-07-30' }]);
  try {
    const written = [];
    const result = executeSecurityCommand(['audit-exceptions', 'reject', 'SEC-EXPIRED'], {
      projectRoot: dir, now: new Date('2026-08-05T00:00:00Z'), stdout: { write(text) { written.push(text); } },
    });
    assert.equal(result.exitCode, 0);
    assert.match(written.join(''), /rejected SEC-EXPIRED/);
    const saved = JSON.parse(readFileSync(path.join(dir, 'security/dependency-exceptions.json'), 'utf8'));
    assert.deepEqual(saved.exceptions, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
