import { diffSnapshots } from './diff';
import { inventoryFromSnapshot, snapshotSqlite } from './sqlite-source';
import {
  MIGRATION_OUTPUT_ROOT,
  assertMigrationRunId,
  writeMigrationReport,
  writeSnapshotExport,
} from './report-writer';
import type { SourceSnapshot } from './types';

type CommandName = 'inventory' | 'diff';

interface BaseArgs {
  command: CommandName;
  runId: string;
}

export interface InventoryArgs extends BaseArgs {
  command: 'inventory';
  source: string;
}

export interface DiffArgs extends BaseArgs {
  command: 'diff';
  primary: string;
  secondary: string;
}

export type ParsedArgs = InventoryArgs | DiffArgs;

export interface CliDependencies {
  outputRoot?: string;
  readSnapshot?: (sourcePath: string) => SourceSnapshot;
}

export interface CliIo {
  stderr: { write(value: string): unknown };
}

function required(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredRunId(options: Map<string, string>): string {
  const runId = required(options, '--run-id');
  assertMigrationRunId(runId);
  return runId;
}

function parseOptions(tokens: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 2) {
    const name = tokens[index];
    const value = tokens[index + 1];
    if (!name?.startsWith('--') || !value || value.startsWith('--') || options.has(name)) throw new Error('Invalid migration CLI arguments');
    options.set(name, value);
  }
  return options;
}

function assertAllowedOptions(command: CommandName, options: Map<string, string>): void {
  const allowed = command === 'diff'
    ? new Set(['--primary', '--secondary', '--run-id'])
    : new Set(['--source', '--run-id']);
  if ([...options.keys()].some(option => !allowed.has(option))) throw new Error('Invalid migration CLI arguments');
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] as CommandName | undefined;
  if (!command || !['inventory', 'diff'].includes(command)) {
    throw new Error('A read-only migration command is required');
  }
  const options = parseOptions(argv.slice(1));
  assertAllowedOptions(command, options);
  if (command === 'inventory') {
    return { command, source: required(options, '--source'), runId: requiredRunId(options) };
  }
  return {
    command,
    primary: required(options, '--primary'),
    secondary: required(options, '--secondary'),
    runId: requiredRunId(options),
  };
}

async function runInventory(args: InventoryArgs, dependencies: CliDependencies, outputRoot: string): Promise<void> {
  const snapshot = (dependencies.readSnapshot ?? snapshotSqlite)(args.source);
  const inventory = inventoryFromSnapshot(snapshot);
  writeMigrationReport(args.runId, 'source-manifest.json', inventory.source, outputRoot);
  writeMigrationReport(args.runId, 'inventory.json', { ...inventory, runId: args.runId }, outputRoot);
  writeSnapshotExport(args.runId, 'source-snapshot.json', snapshot, outputRoot);
}

async function runDiff(args: DiffArgs, dependencies: CliDependencies, outputRoot: string): Promise<void> {
  const readSnapshot = dependencies.readSnapshot ?? snapshotSqlite;
  const primary = readSnapshot(args.primary);
  const secondary = readSnapshot(args.secondary);
  const report = diffSnapshots(primary, secondary);
  writeMigrationReport(args.runId, 'source-manifest.json', { primary: primary.source, secondary: secondary.source }, outputRoot);
  writeMigrationReport(args.runId, 'diff-report.json', { ...report, runId: args.runId }, outputRoot);
  writeSnapshotExport(args.runId, 'primary-snapshot.json', primary, outputRoot);
  writeSnapshotExport(args.runId, 'secondary-snapshot.json', secondary, outputRoot);
}

export async function executeCommand(args: ParsedArgs, dependencies: CliDependencies = {}): Promise<void> {
  const outputRoot = dependencies.outputRoot ?? MIGRATION_OUTPUT_ROOT;
  if (args.command === 'inventory') return runInventory(args, dependencies, outputRoot);
  return runDiff(args, dependencies, outputRoot);
}

function safeCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^(A read-only migration command is required|Invalid migration CLI arguments|Invalid migration run ID|--[a-z-]+ is required)$/.test(message)
    ? message
    : 'Migration command failed';
}

export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
  io: CliIo = { stderr: process.stderr },
): Promise<number> {
  try {
    await executeCommand(parseArgs(argv), dependencies);
    return 0;
  } catch (error) {
    io.stderr.write(`${safeCliError(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then(exitCode => {
    process.exitCode = exitCode;
  });
}
