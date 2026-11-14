import * as path from 'path';

type RuntimeProcess = {
  execPath: string;
  pkg?: unknown;
};

function resolveRuntimeDirectory(
  baseDir: string,
  directoryName: string,
  runtime: RuntimeProcess,
): string {
  if (typeof runtime.pkg !== 'undefined') {
    return path.join(path.dirname(runtime.execPath), directoryName);
  }
  return path.join(baseDir, directoryName);
}

export function resolveStaticDirectory(
  baseDir: string,
  runtime: RuntimeProcess = process as RuntimeProcess,
): string {
  return resolveRuntimeDirectory(baseDir, 'public', runtime);
}

export function resolveRunDirectory(
  baseDir: string,
  runtime: RuntimeProcess = process as RuntimeProcess,
): string {
  return resolveRuntimeDirectory(baseDir, 'run', runtime);
}
