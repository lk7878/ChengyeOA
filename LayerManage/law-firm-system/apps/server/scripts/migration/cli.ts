import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { diffSnapshots } from './diff';
import { ImportFailure, importSnapshotFromDatabaseUrl, type ImportPool, type ImportPoolFactory } from './import-postgres';
import { inventorySqlite, snapshotSqlite } from './sqlite-source';
import { MIGRATION_OUTPUT_ROOT, assertMigrationRunId, migrationRunDirectory, sha256File, writeMigrationReport, writeSnapshotExport } from './report-writer';
import { validateMigration, type ValidationQueryable } from './validate';

type CommandName = 'inventory' | 'diff' | 'import' | 'validate';

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

export interface ImportArgs extends BaseArgs {
  command: 'import';
  confirmDiff: string;
  diffRunId: string;
  source: string;
}

export interface ValidateArgs extends BaseArgs {
  command: 'validate';
  source: string;
}

export type ParsedArgs = InventoryArgs | DiffArgs | ImportArgs | ValidateArgs;

export interface ValidationPool extends ValidationQueryable {
  end(): Promise<void>;
}

export interface CliDependencies {
  createPool?: ImportPoolFactory;
  createValidationPool?: (databaseUrl: string) => ValidationPool;
  databaseUrl?: string;
  outputRoot?: string;
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
    : command === 'import'
      ? new Set(['--source', '--confirm-diff', '--diff-run-id', '--run-id'])
      : new Set(['--source', '--run-id']);
  if ([...options.keys()].some(option => !allowed.has(option))) throw new Error('Invalid migration CLI arguments');
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] as CommandName | undefined;
  if (!command || !['inventory', 'diff', 'import', 'validate'].includes(command)) throw new Error('A migration command is required');
  const options = parseOptions(argv.slice(1));
  assertAllowedOptions(command, options);

  if (command === 'inventory') return { command, source: required(options, '--source'), runId: requiredRunId(options) };
  if (command === 'diff') return {
    command,
    primary: required(options, '--primary'),
    secondary: required(options, '--secondary'),
    runId: requiredRunId(options),
  };
  if (command === 'validate') return { command, source: required(options, '--source'), runId: requiredRunId(options) };
  return {
    command,
    source: required(options, '--source'),
    confirmDiff: required(options, '--confirm-diff'),
    diffRunId: required(options, '--diff-run-id'),
    runId: requiredRunId(options),
  };
}

function assertConfirmedDiff(outputRoot: string, diffRunId: string, confirmation: string): void {
  let actual: string;
  try {
    actual = sha256File(path.join(migrationRunDirectory(diffRunId, outputRoot), 'diff-report.json'));
  } catch {
    throw new Error('Diff report confirmation failed');
  }
  const expectedBuffer = Buffer.from(confirmation, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  if (!/^[a-f0-9]{64}$/i.test(confirmation) || expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error('Diff report confirmation failed');
  }
}

function databaseUrl(dependencies: CliDependencies): string {
  const value = dependencies.databaseUrl ?? process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required');
  return value;
}

function defaultImportPool(databaseUrlValue: string): ImportPool {
  return new Pool({ connectionString: databaseUrlValue });
}

function defaultValidationPool(databaseUrlValue: string): ValidationPool {
  return new Pool({ connectionString: databaseUrlValue });
}

async function runInventory(args: InventoryArgs, outputRoot: string): Promise<void> {
  const inventory = inventorySqlite(args.source);
  const snapshot = snapshotSqlite(args.source);
  writeMigrationReport(args.runId, 'source-manifest.json', inventory.source, outputRoot);
  writeMigrationReport(args.runId, 'inventory.json', { ...inventory, runId: args.runId }, outputRoot);
  writeSnapshotExport(args.runId, 'source-snapshot.json', snapshot, outputRoot);
}

async function runDiff(args: DiffArgs, outputRoot: string): Promise<void> {
  const primary = snapshotSqlite(args.primary);
  const secondary = snapshotSqlite(args.secondary);
  const report = diffSnapshots(primary, secondary);
  writeMigrationReport(args.runId, 'source-manifest.json', { primary: primary.source, secondary: secondary.source }, outputRoot);
  writeMigrationReport(args.runId, 'diff-report.json', { ...report, runId: args.runId }, outputRoot);
  writeSnapshotExport(args.runId, 'primary-snapshot.json', primary, outputRoot);
  writeSnapshotExport(args.runId, 'secondary-snapshot.json', secondary, outputRoot);
}

async function runImport(args: ImportArgs, dependencies: CliDependencies, outputRoot: string): Promise<void> {
  assertConfirmedDiff(outputRoot, args.diffRunId, args.confirmDiff);
  const snapshot = snapshotSqlite(args.source);
  writeSnapshotExport(args.runId, 'source-snapshot.json', snapshot, outputRoot);
  try {
    const report = await importSnapshotFromDatabaseUrl(databaseUrl(dependencies), snapshot, dependencies.createPool ?? defaultImportPool);
    writeMigrationReport(args.runId, 'import-report.json', report, outputRoot);
  } catch (error) {
    if (error instanceof ImportFailure) writeMigrationReport(args.runId, 'import-report.json', error.report, outputRoot);
    throw error;
  }
}

async function runValidate(args: ValidateArgs, dependencies: CliDependencies, outputRoot: string): Promise<void> {
  const pool = (dependencies.createValidationPool ?? defaultValidationPool)(databaseUrl(dependencies));
  try {
    const report = await validateMigration(pool, snapshotSqlite(args.source));
    writeMigrationReport(args.runId, 'validation-report.json', report, outputRoot);
  } finally {
    await pool.end();
  }
}

export async function executeCommand(args: ParsedArgs, dependencies: CliDependencies = {}): Promise<void> {
  const outputRoot = dependencies.outputRoot ?? MIGRATION_OUTPUT_ROOT;
  if (args.command === 'inventory') return runInventory(args, outputRoot);
  if (args.command === 'diff') return runDiff(args, outputRoot);
  if (args.command === 'import') return runImport(args, dependencies, outputRoot);
  return runValidate(args, dependencies, outputRoot);
}

function safeCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^(A migration command is required|Invalid migration CLI arguments|--[a-z-]+ is required|Diff report confirmation failed|DATABASE_URL is required)$/.test(message)
    ? message
    : 'Migration command failed';
}

if (require.main === module) {
  executeCommand(parseArgs(process.argv.slice(2))).catch(error => {
    process.stderr.write(`${safeCliError(error)}\n`);
    process.exitCode = 1;
  });
}
