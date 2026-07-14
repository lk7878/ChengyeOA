import fs from 'node:fs';
import path from 'node:path';

export function discoverBackendTests(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return discoverBackendTests(candidate);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [candidate] : [];
  }).sort();
}
