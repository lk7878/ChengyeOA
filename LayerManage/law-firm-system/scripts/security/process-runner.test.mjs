import assert from 'node:assert/strict';
import test from 'node:test';
import { auditReportFromResult, runCommand, runNpm } from './process-runner.mjs';

const cleanAudit = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
});

test('uses the npm CLI through Node on Windows and npm on Linux without a shell', () => {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: '10.9.2\n', stderr: '' };
  };

  runNpm(['--version'], {
    platform: 'win32',
    cwd: 'C:\\repo',
    spawn,
    nodeExecutable: 'C:\\nodejs\\node.exe',
    npmCliPath: 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
  });
  runNpm(['--version'], { platform: 'linux', cwd: '/repo', spawn });

  assert.equal(calls[0].command, 'C:\\nodejs\\node.exe');
  assert.deepEqual(calls[0].args, ['C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', '--version']);
  assert.equal(calls[1].command, 'npm');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});

test('accepts npm audit status one only when stdout is a supported report', () => {
  const report = auditReportFromResult({ status: 1, stdout: cleanAudit, stderr: '' });
  assert.equal(report.auditReportVersion, 2);

  assert.throws(() => auditReportFromResult({ status: 1, stdout: '', stderr: 'network failed' }), /empty/i);
  assert.throws(() => auditReportFromResult({ status: 2, stdout: cleanAudit, stderr: '' }), /exit status 2/i);
});

test('maps spawn failures and excessive diagnostics to safe bounded errors', () => {
  assert.throws(() => runCommand('npm', ['audit'], {
    cwd: '/repo',
    spawn: () => { throw new Error('C:\\Users\\secret\\token-value'); },
  }), /could not start/);

  assert.throws(() => auditReportFromResult({
    status: 1,
    stdout: '',
    stderr: 'x'.repeat(20_000),
  }), error => error.message.length < 600 && !error.message.includes('x'.repeat(1000)));
});
