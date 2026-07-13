import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';
import { diffSnapshots } from './diff';
import { ImportFailure, importSnapshotFromDatabaseUrl, type ImportPool, type ImportPoolFactory } from './import-postgres';
import { inventoryFromSnapshot, snapshotSqlite } from './sqlite-source';
import {
  abortImportReportReservation,
  MIGRATION_OUTPUT_ROOT,
  assertMigrationRunId,
  migrationRunDirectory,
  parseMigrationReport,
  publishReservedImportReport,
  readPublishedArtifact,
  reserveImportReport,
  writeMigrationReport,
  writeSnapshotExport,
} from './report-writer';
import type { DiffReport, SourceSnapshot } from './types';
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
  readSnapshot?: (sourcePath: string) => SourceSnapshot;
}

export interface CliIo {
  stderr: { write(value: string): unknown };
}

export class MigrationValidationFailedError extends Error {
  constructor() {
    super('Migration validation failed');
    this.name = 'MigrationValidationFailedError';
  }
}

export class ImportReportRecoveryRequiredError extends Error {
  constructor() {
    super('Import report recovery required');
    this.name = 'ImportReportRecoveryRequiredError';
  }
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
  const source = required(options, '--source');
  const confirmDiff = required(options, '--confirm-diff');
  const diffRunId = required(options, '--diff-run-id');
  assertMigrationRunId(diffRunId);
  return {
    command,
    source,
    confirmDiff,
    diffRunId,
    runId: requiredRunId(options),
  };
}

function confirmedDiffReport(outputRoot: string, diffRunId: string, confirmation: string): DiffReport {
  try {
    if (!/^[a-f0-9]{64}$/i.test(confirmation)) throw new Error('invalid confirmation');
    const bytes = readPublishedArtifact(path.join(migrationRunDirectory(diffRunId, outputRoot), 'diff-report.json'));
    const actual = createHash('sha256').update(bytes).digest();
    const expected = Buffer.from(confirmation, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('hash mismatch');
    const report = parseMigrationReport('diff-report.json', JSON.parse(bytes.toString('utf8')));
    if (report.runId !== diffRunId) throw new Error('run ID mismatch');
    return report;
  } catch {
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

async function runImport(args: ImportArgs, dependencies: CliDependencies, outputRoot: string): Promise<void> {
  const diff = confirmedDiffReport(outputRoot, args.diffRunId, args.confirmDiff);
  const snapshot = (dependencies.readSnapshot ?? snapshotSqlite)(args.source);
  if (snapshot.source.sha256.toLowerCase() !== diff.sources.primary.sha256.toLowerCase()) {
    throw new Error('Confirmed diff does not match source');
  }
  const resolvedDatabaseUrl = databaseUrl(dependencies);
  const reservation = reserveImportReport(args.runId, outputRoot);
  let committed = false;
  let transactionStarted = false;

  try {
    writeSnapshotExport(args.runId, 'source-snapshot.json', snapshot, outputRoot);
    const report = await importSnapshotFromDatabaseUrl(
      resolvedDatabaseUrl,
      snapshot,
      dependencies.createPool ?? defaultImportPool,
      {
        committed() { committed = true; },
        transactionStarted() { transactionStarted = true; },
      },
    );
    publishReservedImportReport(reservation, report);
  } catch (error) {
    if (error instanceof ImportFailure) {
      try {
        publishReservedImportReport(reservation, error.report);
      } catch {
        throw new ImportReportRecoveryRequiredError();
      }
      throw error;
    }
    if (committed || transactionStarted) throw new ImportReportRecoveryRequiredError();
    try {
      abortImportReportReservation(reservation);
    } catch {
      throw new ImportReportRecoveryRequiredError();
    }
    throw error;
  }
}

async function runValidate(args: ValidateArgs, dependencies: CliDependencies, outputRoot: string): Promise<void> {
  const pool = (dependencies.createValidationPool ?? defaultValidationPool)(databaseUrl(dependencies));
  try {
    const report = await validateMigration(pool, (dependencies.readSnapshot ?? snapshotSqlite)(args.source));
    writeMigrationReport(args.runId, 'validation-report.json', report, outputRoot);
    if (!report.ok) throw new MigrationValidationFailedError();
  } finally {
    await pool.end();
  }
}

export async function executeCommand(args: ParsedArgs, dependencies: CliDependencies = {}): Promise<void> {
  const outputRoot = dependencies.outputRoot ?? MIGRATION_OUTPUT_ROOT;
  if (args.command === 'inventory') return runInventory(args, dependencies, outputRoot);
  if (args.command === 'diff') return runDiff(args, dependencies, outputRoot);
  if (args.command === 'import') return runImport(args, dependencies, outputRoot);
  return runValidate(args, dependencies, outputRoot);
}

function safeCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^(A migration command is required|Invalid migration CLI arguments|Invalid migration run ID|--[a-z-]+ is required|Diff report confirmation failed|Confirmed diff does not match source|DATABASE_URL is required|Import report recovery required|Migration validation failed)$/.test(message)
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
