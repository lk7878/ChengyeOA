import fs from 'node:fs';
import path from 'node:path';

interface PackageManifest {
  scripts?: Record<string, string>;
  prisma?: { seed?: unknown };
  pkg?: { assets?: unknown };
}

const CANONICAL_PRISMA_MODEL_COUNT = 95;
const CANONICAL_PRISMA_MIGRATION_COUNT = 63;

function packageManifest(filePath: string): PackageManifest {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageManifest;
}

function hasPrismaSeedConfiguration(manifest: PackageManifest): boolean {
  return manifest.prisma !== undefined && Object.prototype.hasOwnProperty.call(manifest.prisma, 'seed');
}

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(candidate);
    return entry.isFile() && /\.(?:[cm]?js|ts)$/.test(entry.name) ? [candidate] : [];
  });
}

function allFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return allFiles(candidate);
    return entry.isFile() ? [candidate] : [];
  });
}

function isForbiddenArtifact(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    /(?:^|[-_.])(?:credentials?|secrets?)(?:[-_.]|$)/i.test(name) ||
    /\.(?:key|pem|p12|pfx)$/i.test(name)
  );
}

function normalizedRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function hasGenericSeedScript(serverRoot: string): boolean {
  const prismaSeeds = ['seed.ts', 'seed.js', 'seed.cjs', 'seed.mjs'].map((name) =>
    path.join(serverRoot, 'prisma', name),
  );
  return (
    prismaSeeds.some((filePath) => fs.existsSync(filePath)) ||
    sourceFiles(path.join(serverRoot, 'scripts')).some((filePath) =>
      /^seed\.(?:[cm]?js|ts)$/.test(path.basename(filePath)),
    )
  );
}

function runtimeSourceFiles(serverRoot: string): string[] {
  const startupFiles = [
    path.join(serverRoot, 'server-entry.js'),
    path.join(serverRoot, 'app.ts'),
    path.join(serverRoot, 'app.js'),
    path.join(serverRoot, 'scripts', 'build-pkg.js'),
    path.join(serverRoot, 'scripts', 'build.js'),
  ].filter((filePath) => fs.existsSync(filePath));
  return [...startupFiles, ...sourceFiles(path.join(serverRoot, 'config'))];
}

export function checkBaselineContract(projectRoot: string): string[] {
  const issues: string[] = [];
  const serverRoot = path.join(projectRoot, 'apps', 'server');
  const canonicalSchemaPath = path.join(serverRoot, 'prisma', 'schema.prisma');
  if (fs.existsSync(path.join(projectRoot, 'prisma', 'schema.prisma')))
    issues.push('duplicate root Prisma schema exists');
  if (!fs.existsSync(canonicalSchemaPath)) {
    issues.push('canonical Prisma schema is missing');
  } else {
    const canonicalSchema = fs.readFileSync(canonicalSchemaPath, 'utf8');
    const modelCount = [...canonicalSchema.matchAll(/^model\s+\w+\s+\{/gm)].length;
    if (modelCount !== CANONICAL_PRISMA_MODEL_COUNT) {
      issues.push(`canonical Prisma model count is ${modelCount}; expected ${CANONICAL_PRISMA_MODEL_COUNT}`);
    }
    const employee = canonicalSchema.match(/model Employee\s+\{[\s\S]*?^\}/m)?.[0] ?? '';
    if (/^\s*(?:orgId|positionId)\s+/m.test(employee)) {
      issues.push('Employee retains direct organization ownership fields');
    }
  }
  const migrationsRoot = path.join(serverRoot, 'prisma', 'migrations');
  const migrationCount = fs.existsSync(migrationsRoot)
    ? fs.readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
    : 0;
  if (migrationCount !== CANONICAL_PRISMA_MIGRATION_COUNT) {
    issues.push(
      `canonical Prisma migration count is ${migrationCount}; expected ${CANONICAL_PRISMA_MIGRATION_COUNT}`,
    );
  }
  if (hasGenericSeedScript(serverRoot)) issues.push('generic seed script exists');
  if (fs.existsSync(path.join(serverRoot, 'scripts', 'build-dist.js')))
    issues.push('SQLite distribution builder exists');

  const rootManifest = packageManifest(path.join(projectRoot, 'package.json'));
  const serverManifest = packageManifest(path.join(serverRoot, 'package.json'));
  const rootScripts = rootManifest.scripts ?? {};
  const serverScripts = serverManifest.scripts ?? {};
  if (hasPrismaSeedConfiguration(rootManifest)) issues.push('root Prisma seed configuration exists');
  if (hasPrismaSeedConfiguration(serverManifest)) issues.push('server Prisma seed configuration exists');
  for (const name of ['seed', 'migration:import', 'migration:validate', 'db:seed']) {
    if (rootScripts[name] || serverScripts[name]) issues.push(`${name} command exists`);
  }

  const packageAssets = Array.isArray(serverManifest.pkg?.assets) ? serverManifest.pkg.assets : [];
  for (const asset of packageAssets) {
    if (typeof asset === 'string') {
      if (/^dist\/\*\*\/?\*?$/.test(asset)) issues.push(`broad package asset input exists: ${asset}`);
      if (isForbiddenArtifact(asset)) issues.push(`forbidden package asset input: ${asset}`);
    }
  }

  const buildSources = [
    path.join(serverRoot, 'scripts', 'build.js'),
    path.join(serverRoot, 'scripts', 'build-pkg.js'),
  ]
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  if (/\[['"]\.env(?:\.[^'"]*)?['"]\s*,/i.test(buildSources)) {
    issues.push('environment file build input exists');
  }

  const packagingSources = [
    path.join(projectRoot, 'scripts', 'build-zip.ps1'),
    path.join(projectRoot, 'scripts', 'installer.iss'),
  ]
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  for (const pattern of [/admin\s*\/\s*123456/i, /sqlite/i]) {
    if (pattern.test(packagingSources)) issues.push(`forbidden packaging pattern: ${pattern.source}`);
  }

  const activeRuntimeDocumentation = [path.join(projectRoot, 'docs', 'api-spec.md')];
  for (const filePath of activeRuntimeDocumentation.filter((candidate) => fs.existsSync(candidate))) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (/sqlite/i.test(source) || /DATABASE_URL\s*=\s*file:/i.test(source)) {
      issues.push(`active SQLite runtime documentation exists: ${normalizedRelative(projectRoot, filePath)}`);
    }
  }

  for (const outputRoot of [path.join(serverRoot, 'dist'), path.join(projectRoot, 'apps', 'dist')]) {
    for (const filePath of allFiles(outputRoot).filter(isForbiddenArtifact)) {
      issues.push(`forbidden build artifact: ${normalizedRelative(projectRoot, filePath)}`);
    }
  }

  const composePath = path.join(projectRoot, 'infra', 'postgres', 'compose.yml');
  const compose = fs.existsSync(composePath) ? fs.readFileSync(composePath, 'utf8') : '';
  if (!/POSTGRES_DB:\s*\$\{POSTGRES_DB:-chengye_oa\}/.test(compose))
    issues.push('Compose POSTGRES_DB is not parameterized');
  if (!/POSTGRES_USER:\s*\$\{POSTGRES_USER:-chengye_app\}/.test(compose))
    issues.push('Compose POSTGRES_USER is not parameterized');
  if (!/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:-chengye_local_only\}/.test(compose))
    issues.push('Compose POSTGRES_PASSWORD is not parameterized');
  if (!/pg_isready -U \$\$\{POSTGRES_USER:-chengye_app\} -d \$\$\{POSTGRES_DB:-chengye_oa\}/.test(compose)) {
    issues.push('Compose healthcheck is not parameterized');
  }
  const initializerPath = path.join(projectRoot, 'infra', 'postgres', 'init', '01-create-test-database.sh');
  const initializer = fs.existsSync(initializerPath) ? fs.readFileSync(initializerPath, 'utf8') : '';
  if (
    !/POSTGRES_TEST_DB.*chengye_oa_test/.test(initializer) ||
    !/POSTGRES_TEST_USER.*chengye_test/.test(initializer) ||
    !/POSTGRES_TEST_PASSWORD.*chengye_test_local_only/.test(initializer)
  ) {
    issues.push('test database initializer is not parameterized');
  }

  const runtimeSources = runtimeSourceFiles(serverRoot)
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  for (const pattern of [
    /file:/i,
    /law_firm\.db/i,
    /admin\s*\/\s*123456/i,
    /organization\.create/i,
    /Run seed/i,
    /种子数据/i,
  ]) {
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
