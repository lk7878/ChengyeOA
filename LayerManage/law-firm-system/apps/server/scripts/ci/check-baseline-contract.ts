import fs from 'node:fs';
import path from 'node:path';

function packageScripts(filePath: string): Record<string, string> {
  return (JSON.parse(fs.readFileSync(filePath, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
}

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(candidate);
    return entry.isFile() && /\.(?:[cm]?js|ts)$/.test(entry.name) ? [candidate] : [];
  });
}

function hasGenericSeedScript(serverRoot: string): boolean {
  const prismaSeeds = ['seed.ts', 'seed.js', 'seed.cjs', 'seed.mjs']
    .map(name => path.join(serverRoot, 'prisma', name));
  return prismaSeeds.some(filePath => fs.existsSync(filePath))
    || sourceFiles(path.join(serverRoot, 'scripts')).some(filePath => /^seed\.(?:[cm]?js|ts)$/.test(path.basename(filePath)));
}

function runtimeSourceFiles(serverRoot: string): string[] {
  const startupFiles = [
    path.join(serverRoot, 'server-entry.js'),
    path.join(serverRoot, 'app.ts'),
    path.join(serverRoot, 'app.js'),
    path.join(serverRoot, 'scripts', 'build-package.js'),
    path.join(serverRoot, 'scripts', 'build.js'),
  ].filter(filePath => fs.existsSync(filePath));
  return [...startupFiles, ...sourceFiles(path.join(serverRoot, 'config'))];
}

export function checkBaselineContract(projectRoot: string): string[] {
  const issues: string[] = [];
  const serverRoot = path.join(projectRoot, 'apps', 'server');
  if (fs.existsSync(path.join(projectRoot, 'prisma', 'schema.prisma'))) issues.push('duplicate root Prisma schema exists');
  if (!fs.existsSync(path.join(serverRoot, 'prisma', 'schema.prisma'))) issues.push('canonical Prisma schema is missing');
  if (hasGenericSeedScript(serverRoot)) issues.push('generic seed script exists');
  if (fs.existsSync(path.join(serverRoot, 'scripts', 'build-dist.js'))) issues.push('SQLite distribution builder exists');

  const rootScripts = packageScripts(path.join(projectRoot, 'package.json'));
  const serverScripts = packageScripts(path.join(serverRoot, 'package.json'));
  for (const name of ['seed', 'migration:import', 'migration:validate', 'db:seed']) {
    if (rootScripts[name] || serverScripts[name]) issues.push(`${name} command exists`);
  }

  const runtimeSources = runtimeSourceFiles(serverRoot).map(filePath => fs.readFileSync(filePath, 'utf8')).join('\n');
  for (const pattern of [/file:/i, /law_firm\.db/i, /admin\s*\/\s*123456/i, /organization\.create/i, /Run seed/i, new RegExp('\\u7ec9\\u5d85\\u74d9\\u93c1\\u7248\\u5d41', 'i')]) {
    if (pattern.test(runtimeSources)) issues.push(`forbidden runtime pattern: ${pattern.source}`);
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
