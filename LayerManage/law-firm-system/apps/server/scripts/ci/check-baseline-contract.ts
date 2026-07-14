import fs from 'node:fs';
import path from 'node:path';

function packageScripts(filePath: string): Record<string, string> {
  return (JSON.parse(fs.readFileSync(filePath, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
}

export function checkBaselineContract(projectRoot: string): string[] {
  const issues: string[] = [];
  const serverRoot = path.join(projectRoot, 'apps', 'server');
  if (fs.existsSync(path.join(projectRoot, 'prisma', 'schema.prisma'))) issues.push('duplicate root Prisma schema exists');
  if (!fs.existsSync(path.join(serverRoot, 'prisma', 'schema.prisma'))) issues.push('canonical Prisma schema is missing');
  if (fs.existsSync(path.join(serverRoot, 'prisma', 'seed.ts'))) issues.push('Prisma seed exists');
  if (fs.existsSync(path.join(serverRoot, 'scripts', 'build-dist.js'))) issues.push('SQLite distribution builder exists');

  const rootScripts = packageScripts(path.join(projectRoot, 'package.json'));
  const serverScripts = packageScripts(path.join(serverRoot, 'package.json'));
  for (const name of ['migration:import', 'migration:validate', 'db:seed']) {
    if (rootScripts[name] || serverScripts[name]) issues.push(`${name} command exists`);
  }

  const startupSources = [
    path.join(serverRoot, 'server-entry.js'),
    path.join(serverRoot, 'scripts', 'build-package.js'),
  ].map(filePath => fs.readFileSync(filePath, 'utf8')).join('\n');
  for (const pattern of [/file:/i, /law_firm\.db/i, /admin\s*\/\s*123456/i, /organization\.create/i, /Run seed/i, /绉嶅瓙鏁版嵁/i]) {
    if (pattern.test(startupSources)) issues.push(`forbidden startup pattern: ${pattern.source}`);
  }
  return issues;
}

if (require.main === module) {
  const projectRoot = path.resolve(__dirname, '../../../..');
  const issues = checkBaselineContract(projectRoot);
  if (issues.length > 0) {
    process.stderr.write(`${issues.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Baseline contract is valid.\n');
  }
}
