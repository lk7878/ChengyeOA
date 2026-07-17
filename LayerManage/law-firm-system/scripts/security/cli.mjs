import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSecurityConfiguration } from './policy.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const command = process.argv[2];

try {
  if (command !== 'policy') throw new Error('Unsupported security command');
  const { policy } = loadSecurityConfiguration(projectRoot);
  process.stdout.write(`Dependency policy valid for ${policy.workspaces.map(item => item.name).join(', ')}.\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown security policy error';
  process.stderr.write(`Dependency security check failed: ${message}\n`);
  process.exitCode = 1;
}
