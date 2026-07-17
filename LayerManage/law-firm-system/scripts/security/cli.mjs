import path from 'node:path';
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
const COMMANDS = new Set(['policy', 'audit-prod', 'audit-all', 'sbom']);

function fail(message) {
  throw new Error(message);
}

export function parseCommandArguments(args) {
  const command = args[0];
  if (!COMMANDS.has(command)) fail('Unsupported security command');
  if (args.length === 1) return { command };
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
