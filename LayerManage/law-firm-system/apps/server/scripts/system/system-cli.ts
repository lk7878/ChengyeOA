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
  RecoveryWindowUnavailableError,
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
import {
  type AddSecondSuperAdminInput,
  type AddSecondSuperAdminResult,
  SecondSuperAdminService,
} from '../../app/application/system/second-super-admin-service';
import {
  AdminMfaRecoveryInput,
  AdminMfaRecoveryService,
} from '../../app/application/system/admin-mfa-recovery-service';
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
  runAddSecondSuperAdmin?(
    prisma: PrismaClient,
    input: AddSecondSuperAdminInput,
    metadata: SystemCommandMetadata,
  ): Promise<AddSecondSuperAdminResult>;
  runAdminMfaRecovery?(
    prisma: PrismaClient,
    input: AdminMfaRecoveryInput,
    metadata: SystemCommandMetadata,
  ): Promise<{ username: string }>;
}

interface DatabaseTarget {
  databaseName: string;
  display: string;
}

const SAFE_INTERACTIVE_BOOTSTRAP_FLAG = '--safe-interactive';

const safeBootstrapPromptLabels = [
  '[SAFE_INPUT_ORGANIZATION_NAME] ',
  '[SAFE_INPUT_SUPER_ADMIN_USERNAME] ',
  '[SAFE_INPUT_TEMPORARY_PASSWORD] ',
  '[SAFE_INPUT_TEMPORARY_PASSWORD_CONFIRMATION] ',
  '[SAFE_INPUT_BOOTSTRAP_CONFIRMATION] ',
] as const;

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
  const safeInteractive = argv.length === 1 && argv[0] === SAFE_INTERACTIVE_BOOTSTRAP_FLAG;
  try {
    assertBootstrapArgumentsAndInteractiveTerminal(argv, deps);
    const target = databaseTarget(env.DATABASE_URL);
    if (!safeInteractive) writeLine(deps.stdout, `Database target: ${target.display}`);
    await deps.assertMigrationsReady(env.DATABASE_URL as string);

    const expectedConfirmation = `INITIALIZE ${target.databaseName}`;
    let organizationName: string;
    let username: string;
    let password: string;
    let confirmation: string;
    let phrase: string;
    if (safeInteractive) {
      organizationName = await deps.prompts.secret(safeBootstrapPromptLabels[0]);
      username = await deps.prompts.secret(safeBootstrapPromptLabels[1]);
      password = await deps.prompts.secret(safeBootstrapPromptLabels[2]);
      confirmation = await deps.prompts.secret(safeBootstrapPromptLabels[3]);
      phrase = await deps.prompts.secret(safeBootstrapPromptLabels[4]);
    } else {
      organizationName = await deps.prompts.text('Root organization name: ');
      username = await deps.prompts.text('Super-admin username: ');
      password = await deps.prompts.secret('Temporary password: ');
      confirmation = await deps.prompts.secret('Confirm temporary password: ');
      phrase = await deps.prompts.text(`Type ${expectedConfirmation} to confirm: `);
    }
    if (password !== confirmation) throw new ValidationCommandError('Password confirmation does not match');
    if (phrase !== expectedConfirmation) throw new ValidationCommandError('Bootstrap confirmation does not match');

    prisma = deps.createPrisma(env.DATABASE_URL as string);
    const result = await runBootstrap(deps, prisma, { organizationName, username, password }, {
      databaseName: target.databaseName,
      hostname: deps.hostname(),
    });
    if (!safeInteractive) writeLine(deps.stdout, `System bootstrap completed for ${result.organizationName}.`);
    return 0;
  } catch (error) {
    return reportError(error, deps, safeInteractive);
  } finally {
    await cleanup(deps, prisma);
  }
}

function assertBootstrapArgumentsAndInteractiveTerminal(
  argv: readonly string[],
  deps: SystemCliDependencies,
): void {
  if (!deps.isTty) throw new ValidationCommandError('Interactive terminal is required');
  if (argv.length === 0) return;
  if (argv.length === 1 && argv[0] === SAFE_INTERACTIVE_BOOTSTRAP_FLAG) return;
  throw new ValidationCommandError('This command does not accept arguments');
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

export async function secondSuperAdminMain(
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

    const actorUsername = await deps.prompts.text('Current super-admin username: ');
    const actorPassword = await deps.prompts.secret('Current super-admin password: ');
    const targetUsername = await deps.prompts.text('Second super-admin username: ');
    const reason = await deps.prompts.text('Recovery reason: ');
    const normalizedTarget = normalizeUsername(targetUsername);
    const expectedConfirmation = `ADD SECOND SUPER ADMIN ${target.databaseName} ${normalizedTarget}`;
    const confirmation = await deps.prompts.text(`Type ${expectedConfirmation} to confirm: `);
    if (confirmation !== expectedConfirmation) {
      throw new ValidationCommandError('Second super-admin confirmation does not match');
    }

    prisma = deps.createPrisma(env.DATABASE_URL as string);
    const result = await runAddSecondSuperAdmin(deps, prisma, {
      actorUsername,
      actorPassword,
      targetUsername,
      reason,
      confirmation,
    }, {
      databaseName: target.databaseName,
      hostname: deps.hostname(),
    });
    writeLine(deps.stdout, `Second super-admin added for ${result.targetUsername}.`);
    return 0;
  } catch (error) {
    return reportError(error, deps);
  } finally {
    await cleanup(deps, prisma);
  }
}

export async function adminMfaResetMain(
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

    const username = await deps.prompts.text('Super-admin username: ');
    const password = await deps.prompts.secret('Current super-admin password: ');
    const normalizedUsername = normalizeUsername(username);
    const expectedConfirmation = `RESET ADMIN MFA ${target.databaseName} ${normalizedUsername}`;
    const confirmation = await deps.prompts.text(`Type ${expectedConfirmation} to confirm: `);
    if (confirmation !== expectedConfirmation) {
      throw new ValidationCommandError('Administrator MFA reset confirmation does not match');
    }

    prisma = deps.createPrisma(env.DATABASE_URL as string);
    const result = await runAdminMfaRecovery(deps, prisma, {
      username,
      password,
      confirmation,
    }, {
      databaseName: target.databaseName,
      hostname: deps.hostname(),
    });
    writeLine(deps.stdout, `Administrator MFA reset completed for ${result.username}.`);
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
    if (!url.hostname) throw new Error('missing database host');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!databaseName || containsAsciiControlCharacter(databaseName)) throw new Error('invalid database name');
    return {
      databaseName,
      display: `${url.hostname}:${url.port || '5432'}/${databaseName}`,
    };
  } catch {
    throw new ValidationCommandError('Database configuration is invalid');
  }
}

function containsAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1F || code === 0x7F;
  });
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

async function runAddSecondSuperAdmin(
  deps: SystemCliDependencies,
  prisma: PrismaClient,
  input: AddSecondSuperAdminInput,
  metadata: SystemCommandMetadata,
): Promise<AddSecondSuperAdminResult> {
  if (deps.runAddSecondSuperAdmin) return deps.runAddSecondSuperAdmin(prisma, input, metadata);
  return new SecondSuperAdminService(prisma, new BcryptPasswordHasher(), metadata).execute(input);
}

async function runAdminMfaRecovery(
  deps: SystemCliDependencies,
  prisma: PrismaClient,
  input: AdminMfaRecoveryInput,
  metadata: SystemCommandMetadata,
): Promise<{ username: string }> {
  if (deps.runAdminMfaRecovery) return deps.runAdminMfaRecovery(prisma, input, metadata);
  return new AdminMfaRecoveryService(prisma, new BcryptPasswordHasher(), metadata).execute(input);
}

function reportError(error: unknown, deps: SystemCliDependencies, silent = false): number {
  if (error instanceof ValidationCommandError || error instanceof SecurityError) {
    if (!silent) writeLine(deps.stderr, 'System command input is invalid.');
    return 2;
  }
  if (error instanceof AlreadyInitializedError) {
    if (!silent) writeLine(deps.stderr, 'System is already initialized.');
    return 3;
  }
  if (error instanceof InconsistentSystemStateError) {
    if (!silent) writeLine(deps.stderr, 'System state is inconsistent. Manual investigation is required.');
    return 4;
  }
  if (error instanceof DatabaseStateError || isPrismaDatabaseError(error)) {
    if (!silent) writeLine(deps.stderr, 'Database state is unavailable.');
    return 5;
  }
  if (error instanceof RecoveryDisabledError) {
    if (!silent) writeLine(deps.stderr, 'Super-admin recovery is disabled.');
    return 6;
  }
  if (error instanceof RecoveryWindowUnavailableError) {
    if (!silent) writeLine(deps.stderr, 'Second super-admin recovery window is not available.');
    return 7;
  }
  if (!silent) writeLine(deps.stderr, `System command failed. Reference: ${deps.randomUUID()}`);
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
