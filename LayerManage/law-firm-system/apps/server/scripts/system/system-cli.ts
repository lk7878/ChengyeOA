import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { normalizeUsername } from '../../app/domain/security/password-policy';
import { SecurityError } from '../../app/domain/security/security-errors';
import {
  AlreadyInitializedError,
  DatabaseStateError,
  InconsistentSystemStateError,
  RecoveryDisabledError,
  ValidationCommandError,
} from '../../app/application/system/system-command-errors';
import {
  type BootstrapInput,
  type BootstrapResult,
  type SystemCommandMetadata,
  SystemBootstrapService,
} from '../../app/application/system/system-bootstrap-service';
import {
  type RecoveryInput,
  type RecoveryResult,
  SuperAdminRecoveryService,
} from '../../app/application/system/super-admin-recovery-service';
import { assertMigrationsReady } from './migration-status';
import { Prompts, TerminalPrompts } from './terminal-prompts';

export interface SystemCliDependencies {
  isTty: boolean;
  prompts: Prompts;
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  assertMigrationsReady(databaseUrl: string): Promise<void>;
  createPrisma(databaseUrl: string): PrismaClient;
  hostname(): string;
  randomUUID(): string;
  runBootstrap?(prisma: PrismaClient, input: BootstrapInput, metadata: SystemCommandMetadata): Promise<BootstrapResult>;
  runRecovery?(prisma: PrismaClient, input: RecoveryInput, metadata: SystemCommandMetadata): Promise<RecoveryResult>;
}

interface DatabaseTarget {
  databaseName: string;
  display: string;
}

export const productionSystemCliDependencies: SystemCliDependencies = {
  isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prompts: new TerminalPrompts(),
  stdout: process.stdout,
  stderr: process.stderr,
  assertMigrationsReady,
  createPrisma: databaseUrl => new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
  hostname,
  randomUUID,
};

export async function bootstrapMain(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: SystemCliDependencies = productionSystemCliDependencies,
): Promise<number> {
  let prisma: PrismaClient | undefined;
  try {
    assertNoArgumentsAndInteractiveTerminal(argv, deps);
    const target = databaseTarget(env.DATABASE_URL);
    writeLine(deps.stdout, `Database target: ${target.display}`);
    await deps.assertMigrationsReady(env.DATABASE_URL as string);

    const organizationName = await deps.prompts.text('Root organization name: ');
    const username = await deps.prompts.text('Super-admin username: ');
    const password = await deps.prompts.secret('Temporary password: ');
    const confirmation = await deps.prompts.secret('Confirm temporary password: ');
    if (password !== confirmation) throw new ValidationCommandError('Password confirmation does not match');

    const expectedConfirmation = `INITIALIZE ${target.databaseName}`;
    const phrase = await deps.prompts.text(`Type ${expectedConfirmation} to confirm: `);
    if (phrase !== expectedConfirmation) throw new ValidationCommandError('Bootstrap confirmation does not match');

    prisma = deps.createPrisma(env.DATABASE_URL as string);
    const result = await runBootstrap(deps, prisma, { organizationName, username, password }, {
      databaseName: target.databaseName,
      hostname: deps.hostname(),
    });
    writeLine(deps.stdout, `System bootstrap completed for ${result.organizationName}.`);
    return 0;
  } catch (error) {
    return reportError(error, deps);
  } finally {
    await cleanup(deps, prisma);
  }
}

export async function recoveryMain(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: SystemCliDependencies = productionSystemCliDependencies,
): Promise<number> {
  let prisma: PrismaClient | undefined;
  try {
    assertNoArgumentsAndInteractiveTerminal(argv, deps);
    if (env.ALLOW_SUPER_ADMIN_RECOVERY !== 'true') {
      throw new RecoveryDisabledError('Super-admin recovery is disabled');
    }

    const target = databaseTarget(env.DATABASE_URL);
    writeLine(deps.stdout, `Database target: ${target.display}`);
    await deps.assertMigrationsReady(env.DATABASE_URL as string);

    const username = await deps.prompts.text('Super-admin username: ');
    const temporaryPassword = await deps.prompts.secret('Temporary password: ');
    const passwordConfirmation = await deps.prompts.secret('Confirm temporary password: ');
    if (temporaryPassword !== passwordConfirmation) throw new ValidationCommandError('Password confirmation does not match');
    const reason = await deps.prompts.text('Recovery reason: ');
    const expectedConfirmation = `RECOVER ${target.databaseName} ${normalizeUsername(username)}`;
    const phrase = await deps.prompts.text(`Type ${expectedConfirmation} to confirm: `);
    if (phrase !== expectedConfirmation) throw new ValidationCommandError('Recovery confirmation does not match');

    prisma = deps.createPrisma(env.DATABASE_URL as string);
    const result = await runRecovery(deps, prisma, {
      enabled: true,
      username,
      temporaryPassword,
      reason,
    }, {
      databaseName: target.databaseName,
      hostname: deps.hostname(),
    });
    writeLine(deps.stdout, `Super-admin recovery completed for ${result.username}.`);
    return 0;
  } catch (error) {
    return reportError(error, deps);
  } finally {
    await cleanup(deps, prisma);
  }
}

function assertNoArgumentsAndInteractiveTerminal(argv: readonly string[], deps: SystemCliDependencies): void {
  if (!deps.isTty) throw new ValidationCommandError('Interactive terminal is required');
  if (argv.length > 0) throw new ValidationCommandError('This command does not accept arguments');
}

function databaseTarget(rawDatabaseUrl: string | undefined): DatabaseTarget {
  try {
    if (!rawDatabaseUrl) throw new Error('missing database URL');
    const url = new URL(rawDatabaseUrl);
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('invalid database protocol');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!databaseName) throw new Error('missing database name');
    return {
      databaseName,
      display: `${url.hostname}:${url.port || '5432'}/${databaseName}`,
    };
  } catch {
    throw new ValidationCommandError('Database configuration is invalid');
  }
}

async function runBootstrap(
  deps: SystemCliDependencies,
  prisma: PrismaClient,
  input: BootstrapInput,
  metadata: SystemCommandMetadata,
): Promise<BootstrapResult> {
  if (deps.runBootstrap) return deps.runBootstrap(prisma, input, metadata);
  return new SystemBootstrapService(prisma, new BcryptPasswordHasher(), metadata).execute(input);
}

async function runRecovery(
  deps: SystemCliDependencies,
  prisma: PrismaClient,
  input: RecoveryInput,
  metadata: SystemCommandMetadata,
): Promise<RecoveryResult> {
  if (deps.runRecovery) return deps.runRecovery(prisma, input, metadata);
  return new SuperAdminRecoveryService(prisma, new BcryptPasswordHasher(), metadata).execute(input);
}

function reportError(error: unknown, deps: SystemCliDependencies): number {
  if (error instanceof ValidationCommandError || error instanceof SecurityError) {
    writeLine(deps.stderr, 'System command input is invalid.');
    return 2;
  }
  if (error instanceof AlreadyInitializedError) {
    writeLine(deps.stderr, 'System is already initialized.');
    return 3;
  }
  if (error instanceof InconsistentSystemStateError) {
    writeLine(deps.stderr, 'System state is inconsistent. Manual investigation is required.');
    return 4;
  }
  if (error instanceof DatabaseStateError || isPrismaDatabaseError(error)) {
    writeLine(deps.stderr, 'Database state is unavailable.');
    return 5;
  }
  if (error instanceof RecoveryDisabledError) {
    writeLine(deps.stderr, 'Super-admin recovery is disabled.');
    return 6;
  }
  writeLine(deps.stderr, `System command failed. Reference: ${deps.randomUUID()}`);
  return 70;
}

function isPrismaDatabaseError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientInitializationError
    || error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientUnknownRequestError
    || error instanceof Prisma.PrismaClientValidationError
    || error instanceof Prisma.PrismaClientRustPanicError;
}

async function cleanup(deps: SystemCliDependencies, prisma: PrismaClient | undefined): Promise<void> {
  try {
    await prisma?.$disconnect();
  } catch {
    // The command result is already determined; cleanup must not leak database details.
  } finally {
    try {
      deps.prompts.close();
    } catch {
      // Closing a prompt adapter is best effort after a command failure.
    }
  }
}

function writeLine(output: Pick<NodeJS.WriteStream, 'write'>, message: string): void {
  output.write(`${message}\n`);
}
