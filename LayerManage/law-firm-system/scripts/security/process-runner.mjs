import { spawnSync } from 'node:child_process';
import { parseAuditJson } from './audit-gate.mjs';

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

export function runCommand(command, args, options = {}) {
  const spawn = options.spawn ?? spawnSync;
  let result;
  try {
    result = spawn(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      env: options.env ?? process.env,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      windowsHide: true,
    });
  } catch {
    fail('Security command could not start');
  }
  if (result.error) fail('Security command could not start');
  if (!Number.isInteger(result.status)) fail('Security command returned no exit status');
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr.slice(0, 400) : '',
  };
}

export function runNpm(args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    const npmCliPath = options.npmCliPath ?? process.env.npm_execpath;
    if (!npmCliPath) fail('npm CLI path is unavailable');
    return runCommand(options.nodeExecutable ?? process.execPath, [npmCliPath, ...args], options);
  }
  return runCommand('npm', args, options);
}

export function auditReportFromResult(result) {
  if (result.status !== 0 && result.status !== 1) {
    fail(`npm audit failed with exit status ${result.status}`);
  }
  return parseAuditJson(result.stdout);
}

export function successfulOutput(result, label) {
  if (result.status !== 0) fail(`${label} failed with exit status ${result.status}`);
  if (result.stdout.trim().length === 0) fail(`${label} returned empty output`);
  return result.stdout;
}
