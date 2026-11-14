import path from 'node:path';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateWorkspace } from './audit-gate.mjs';
import { writeAuditSummary, writeSbom } from './artifacts.mjs';
import { loadSecurityConfiguration } from './policy.mjs';
import {
  auditReportFromResult,
  runCommand,
  runNpm,
  successfulOutput,
} from './process-runner.mjs';

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMANDS = new Set(['policy', 'audit-prod', 'audit-all', 'sbom', 'audit-exceptions']);
const DAY_MS = 24 * 60 * 60 * 1000;

function fail(message) {
  throw new Error(message);
}

export function parseCommandArguments(args) {
  const command = args[0];
  if (!COMMANDS.has(command)) fail('Unsupported security command');
  if (args.length === 1) return { command };
  if (command === 'audit-exceptions') {
    if (args[1] === 'approve') {
      if (args.length !== 5 || args[3] !== '--reviewed-by' || args[4].trim() === '') {
        fail('Invalid audit-exceptions approve arguments: approve <id> --reviewed-by <name>');
      }
      return { command, action: 'approve', id: args[2], reviewedBy: args[4].trim() };
    }
    if (args[1] === 'reject') {
      if (args.length !== 3) fail('Invalid audit-exceptions reject arguments: reject <id>');
      return { command, action: 'reject', id: args[2] };
    }
    fail('Invalid audit-exceptions action: use approve or reject');
  }
  if (!['audit-prod', 'audit-all'].includes(command)
    || args.length !== 3
    || args[1] !== '--workspace'
    || !['server', 'web'].includes(args[2])) {
    fail('Invalid security command arguments or workspace');
  }
  return { command, workspace: args[2] };
}

function executionMetadata(projectRoot, now, dependencies) {
  const commit = successfulOutput(
    dependencies.runCommand('git', ['rev-parse', 'HEAD'], { cwd: projectRoot }),
    'git metadata',
  ).trim();
  const npmVersion = successfulOutput(
    dependencies.runNpm(['--version'], { cwd: projectRoot }),
    'npm version',
  ).trim();
  return {
    commit,
    node: process.version,
    npm: npmVersion,
    generatedAt: now.toISOString(),
  };
}

function selectedWorkspaces(policy, requested) {
  return policy.workspaces.filter(workspace => !requested || workspace.name === requested);
}

function runAuditCommand(parsed, config, outputDirectory, metadata, dependencies) {
  const summaries = selectedWorkspaces(config.policy, parsed.workspace).map(workspace => {
    const cwd = path.resolve(dependencies.projectRoot, workspace.path);
    const productionReport = auditReportFromResult(dependencies.runNpm(
      ['audit', '--json', '--omit=dev'],
      { cwd },
    ));
    const fullReport = parsed.command === 'audit-all'
      ? auditReportFromResult(dependencies.runNpm(['audit', '--json'], { cwd }))
      : productionReport;
    return evaluateWorkspace({
      workspace: workspace.name,
      productionReport,
      fullReport,
      policy: config.policy,
      exceptions: config.exceptions,
      baseline: config.baseline,
    });
  });

  const kind = parsed.command === 'audit-prod' ? 'production' : 'full';
  const artifact = dependencies.writeAuditSummary(outputDirectory, kind, summaries, metadata);
  for (const summary of summaries) {
    dependencies.stdout.write(
      `${summary.workspace}: passed=${summary.passed} production_high=${summary.counts.production.high} production_critical=${summary.counts.production.critical}\n`,
    );
  }
  return { exitCode: summaries.every(summary => summary.passed) ? 0 : 1, artifacts: [artifact] };
}

function runSbomCommand(config, outputDirectory, metadata, dependencies) {
  const artifacts = config.policy.workspaces.map(workspace => {
    const cwd = path.resolve(dependencies.projectRoot, workspace.path);
    const source = successfulOutput(dependencies.runNpm([
      'sbom', '--sbom-format=cyclonedx', '--package-lock-only',
    ], { cwd }), 'npm sbom');
    let sbom;
    try {
      sbom = JSON.parse(source);
    } catch {
      fail('npm sbom output is not valid JSON');
    }
    return dependencies.writeSbom(outputDirectory, workspace.name, sbom, metadata);
  });
  dependencies.stdout.write('CycloneDX SBOM generated for server, web.\n');
  return { exitCode: 0, artifacts };
}

export function runExceptionReportCommand(dependencies) {
  const stdout = dependencies.stdout;
  const filePath = path.resolve(dependencies.projectRoot, 'security', 'dependency-exceptions.json');
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    stdout.write('dependency-exceptions.json is missing; no exceptions reported.\n');
    return { exitCode: 0, artifacts: [] };
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    stdout.write('dependency-exceptions.json is not valid JSON; cannot report exceptions.\n');
    return { exitCode: 0, artifacts: [] };
  }
  const entries = Array.isArray(document && document.exceptions) ? document.exceptions : [];
  const today = Date.parse(`${dependencies.now.toISOString().slice(0, 10)}T00:00:00Z`);
  const groups = { approved: [], pending_review: [], expired: [], invalid: [] };
  for (const [index, entry] of entries.entries()) {
    const label = (entry && typeof entry.id === 'string' && entry.id) || `#${index}`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      groups.invalid.push({ label, issue: 'entry is not an object' });
      continue;
    }
    const required = ['id', 'workspace', 'package', 'advisories', 'scope', 'expiresAt'];
    const missing = required.filter(field => entry[field] === undefined || entry[field] === null);
    if (missing.length > 0) {
      groups.invalid.push({ label, issue: `missing required field(s): ${missing.join(', ')}` });
      continue;
    }
    const expiresAt = typeof entry.expiresAt === 'string'
      ? Date.parse(`${entry.expiresAt}T00:00:00Z`)
      : Number.NaN;
    if (!Number.isFinite(expiresAt)) {
      groups.invalid.push({ label, issue: `expiresAt '${entry.expiresAt}' is not a valid date` });
      continue;
    }
    const expired = expiresAt < today;
    const status = entry.status === undefined ? 'approved' : entry.status;
    if (status === 'pending_review') {
      groups.pending_review.push({ label });
      if (expired) groups.expired.push({ label, issue: `expired ${entry.expiresAt}` });
    } else if (status === 'approved') {
      if (expired) groups.expired.push({ label, issue: `expired ${entry.expiresAt}` });
      else groups.approved.push({ label, expiresAt: entry.expiresAt });
    } else {
      groups.invalid.push({ label, issue: `status '${status}' is not valid` });
    }
  }
  const expiringSoon = groups.approved.filter(entry => {
    const at = typeof entry.expiresAt === 'string' ? Date.parse(`${entry.expiresAt}T00:00:00Z`) : Number.NaN;
    return Number.isFinite(at) && at - today <= 14 * DAY_MS;
  });
  stdout.write('Audit dependency exceptions:\n');
  stdout.write(`  approved (${groups.approved.length}): ${groups.approved.map(item => item.label).join(', ') || 'none'}\n`);
  stdout.write(`  pending_review (${groups.pending_review.length}): ${groups.pending_review.map(item => item.label).join(', ') || 'none'}\n`);
  stdout.write(`  expired (${groups.expired.length}): ${groups.expired.map(item => item.label).join(', ') || 'none'}\n`);
  stdout.write(`  invalid (${groups.invalid.length}): ${groups.invalid.map(item => item.label).join(', ') || 'none'}\n`);
  if (expiringSoon.length > 0) {
    stdout.write(`  expiring_soon (within 14 days): ${expiringSoon.map(item => `${item.label} expires ${item.expiresAt}`).join('; ')}\n`);
  }
  return { exitCode: 0, artifacts: [] };
}

function exceptionsFilePath(projectRoot) {
  return path.resolve(projectRoot, 'security', 'dependency-exceptions.json');
}

function writeExceptionsAtomically(filePath, document) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  renameSync(tmp, filePath);
}

export function approveException(dependencies, id, reviewedBy) {
  const config = loadSecurityConfiguration(dependencies.projectRoot, dependencies.now);
  const entry = config.exceptions.find(item => item.id === id);
  if (!entry) fail(`exception ${id} not found`);
  if (entry.status === 'approved') {
    dependencies.stdout.write(`exception ${id} is already approved.\n`);
    return { exitCode: 0, artifacts: [] };
  }
  if (reviewedBy === entry.owner) fail('reviewer must differ from exception owner');
  const today = dependencies.now.toISOString().slice(0, 10);
  entry.status = 'approved';
  entry.approvedBy = reviewedBy;
  entry.reviewedAt = today;
  entry.reviewedBy = reviewedBy;
  writeExceptionsAtomically(exceptionsFilePath(dependencies.projectRoot), { schemaVersion: 1, exceptions: config.exceptions });
  dependencies.stdout.write(`approved ${id} by ${reviewedBy} on ${today}.\n`);
  return { exitCode: 0, artifacts: [] };
}

export function rejectException(dependencies, id) {
  // reject 走宽松读（不跑严格 validateExceptions）：过期/非法条目正是最需清理的对象，
  // 严格校验会 fail-closed 使其无法被移除——仅做最小形状检查后按 id 移除 + 原子写回。
  const filePath = exceptionsFilePath(dependencies.projectRoot);
  let document;
  try {
    document = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    fail('dependency-exceptions.json is not valid JSON; cannot reject an entry');
  }
  if (!document || typeof document !== 'object' || document.schemaVersion !== 1 || !Array.isArray(document.exceptions)) {
    fail('dependency-exceptions.json is malformed; cannot reject an entry');
  }
  const index = document.exceptions.findIndex(item => item && typeof item.id === 'string' && item.id === id);
  if (index === -1) fail(`exception ${id} not found`);
  document.exceptions.splice(index, 1);
  writeExceptionsAtomically(filePath, document);
  dependencies.stdout.write(`rejected ${id} (removed).\n`);
  return { exitCode: 0, artifacts: [] };
}

export function executeSecurityCommand(args, overrides = {}) {
  const parsed = parseCommandArguments(args);
  const dependencies = {
    projectRoot: overrides.projectRoot ?? defaultProjectRoot,
    now: overrides.now ?? new Date(),
    runNpm: overrides.runNpm ?? runNpm,
    runCommand: overrides.runCommand ?? runCommand,
    writeAuditSummary: overrides.writeAuditSummary ?? writeAuditSummary,
    writeSbom: overrides.writeSbom ?? writeSbom,
    stdout: overrides.stdout ?? process.stdout,
  };
  if (parsed.command === 'audit-exceptions') {
    if (parsed.action === 'approve') return approveException(dependencies, parsed.id, parsed.reviewedBy);
    if (parsed.action === 'reject') return rejectException(dependencies, parsed.id);
    return runExceptionReportCommand(dependencies);
  }
  const config = loadSecurityConfiguration(dependencies.projectRoot, dependencies.now);
  if (parsed.command === 'policy') {
    dependencies.stdout.write(
      `Dependency policy valid for ${config.policy.workspaces.map(item => item.name).join(', ')}.\n`,
    );
    return { exitCode: 0, artifacts: [] };
  }

  const outputDirectory = path.resolve(dependencies.projectRoot, config.policy.outputDirectory);
  const metadata = executionMetadata(dependencies.projectRoot, dependencies.now, dependencies);
  if (parsed.command === 'sbom') {
    return runSbomCommand(config, outputDirectory, metadata, dependencies);
  }
  return runAuditCommand(parsed, config, outputDirectory, metadata, dependencies);
}

function isMainModule() {
  return process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
    : false;
}

if (isMainModule()) {
  try {
    const result = executeSecurityCommand(process.argv.slice(2));
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dependency security error';
    process.stderr.write(`Dependency security check failed: ${message}\n`);
    process.exitCode = 1;
  }
}
