import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function testFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(candidate);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [candidate] : [];
  });
}

const files = testFiles(path.resolve('test')).sort();
if (files.length === 0) throw new Error('No backend test files found');
process.env.EGG_TYPESCRIPT = 'true';
const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), '--test', '--test-force-exit', ...files], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
