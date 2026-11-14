import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { discoverBackendTests } from '../test/test-files';

interface SerialChildResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

interface SerialSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: 'inherit';
}

export interface SerialRunnerDependencies {
  discover(root: string): string[];
  spawn(command: string, args: readonly string[], options: SerialSpawnOptions): SerialChildResult;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  kill(pid: number, signal: NodeJS.Signals): boolean;
  platform: NodeJS.Platform;
  pid: number;
  nodeExecutable: string;
  tsxCliPath: string;
}

export function discoverSerialBackendTests(root: string): string[] {
  return discoverBackendTests(root);
}

export function runSerialBackendTests(
  testRoot: string,
  cwd: string,
  dependencies: SerialRunnerDependencies,
): number {
  const files = dependencies.discover(testRoot);
  if (files.length === 0) {
    dependencies.stderr.write('Backend test runner found no test files.\n');
    return 1;
  }
  if (new Set(files).size !== files.length) {
    dependencies.stderr.write('Backend test runner discovered duplicate test files.\n');
    return 1;
  }

  let result: SerialChildResult;
  try {
    result = dependencies.spawn(dependencies.nodeExecutable, [
      dependencies.tsxCliPath,
      '--test',
      '--test-concurrency=1',
      '--test-force-exit',
      ...files,
    ], {
      cwd,
      env: { ...process.env, EGG_TYPESCRIPT: 'true' },
      stdio: 'inherit',
    });
  } catch {
    dependencies.stderr.write('Backend test runner could not start the child process.\n');
    return 1;
  }

  if (result.error) {
    dependencies.stderr.write('Backend test runner could not start the child process.\n');
    return 1;
  }
  if (typeof result.status === 'number') return result.status;
  if (result.signal) {
    if (dependencies.platform === 'win32') {
      dependencies.stderr.write(`Backend tests terminated by signal ${result.signal}.\n`);
      return 1;
    }
    try {
      dependencies.kill(dependencies.pid, result.signal);
    } catch {
      dependencies.stderr.write(
        `Backend tests terminated by signal ${result.signal} and it could not be re-raised.\n`,
      );
    }
    return 1;
  }

  dependencies.stderr.write('Backend test runner returned no exit status.\n');
  return 1;
}

if (require.main === module) {
  const cwd = process.cwd();
  process.exitCode = runSerialBackendTests(path.resolve(cwd, 'test'), cwd, {
    discover: discoverSerialBackendTests,
    spawn: (command, args, options) => spawnSync(command, [...args], options),
    stderr: process.stderr,
    kill: process.kill,
    platform: process.platform,
    pid: process.pid,
    nodeExecutable: process.execPath,
    tsxCliPath: require.resolve('tsx/cli'),
  });
}
