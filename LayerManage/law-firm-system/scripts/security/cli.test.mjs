import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.throws(() => parseCommandArguments(['audit-prod', '--workspace', 'desktop']), /workspace/i);
  assert.throws(() => parseCommandArguments(['audit-all', '--workspace', 'web', '--workspace', 'server']), /arguments/i);
  assert.throws(() => parseCommandArguments(['unknown']), /unsupported/i);
});

test('runs a production audit for only the selected workspace', () => {
  const calls = [];
  const written = [];
  const result = executeSecurityCommand(['audit-prod', '--workspace', 'web'], {
    projectRoot,
    now: new Date('2026-07-17T00:00:00Z'),
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
    now: new Date('2026-07-17T00:00:00Z'),
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
    now: new Date('2026-07-17T00:00:00Z'),
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
