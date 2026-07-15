import fs from 'node:fs';
import path from 'node:path';

interface PackageManifest {
  scripts?: Record<string, string>;
}

function read(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function manifest(filePath: string, label: string, issues: string[]): PackageManifest {
  if (!fs.existsSync(filePath)) {
    issues.push(`${label} package manifest is missing`);
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read(filePath));
  } catch {
    issues.push(`${label} package manifest is invalid JSON`);
    return {};
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    issues.push(`${label} package manifest must contain a JSON object`);
    return {};
  }

  const candidate = parsed as { scripts?: unknown };
  if (candidate.scripts !== undefined
    && (candidate.scripts === null || Array.isArray(candidate.scripts) || typeof candidate.scripts !== 'object')) {
    issues.push(`${label} package scripts must contain a JSON object`);
    return {};
  }

  return candidate as PackageManifest;
}

export function checkBootstrapContract(projectRoot: string): string[] {
  const issues: string[] = [];
  const serverRoot = path.join(projectRoot, 'apps', 'server');
  const rootScripts = manifest(path.join(projectRoot, 'package.json'), 'root', issues).scripts ?? {};
  const serverScripts = manifest(path.join(serverRoot, 'package.json'), 'server', issues).scripts ?? {};
  const schema = read(path.join(serverRoot, 'prisma', 'schema.prisma'));
  const router = read(path.join(serverRoot, 'app', 'router.ts'));
  const envExample = read(path.join(serverRoot, '.env.example'));
  const startup = [
    read(path.join(serverRoot, 'app.ts')),
    read(path.join(serverRoot, 'server-entry.js')),
    read(path.join(serverRoot, 'config', 'config.default.ts')),
  ].join('\n');
  const cli = [
    read(path.join(serverRoot, 'scripts', 'system', 'bootstrap-system.ts')),
    read(path.join(serverRoot, 'scripts', 'system', 'recover-super-admin.ts')),
    read(path.join(serverRoot, 'scripts', 'system', 'system-cli.ts')),
  ].join('\n');

  if (rootScripts['system:bootstrap'] !== 'npm --prefix apps/server run system:bootstrap') issues.push('root bootstrap command is missing or changed');
  if (rootScripts['super-admin:recover'] !== 'npm --prefix apps/server run super-admin:recover') issues.push('root recovery command is missing or changed');
  if (rootScripts['check:bootstrap'] !== 'npm --prefix apps/server run check:bootstrap') issues.push('root bootstrap checker command is missing or changed');
  const verify = rootScripts.verify ?? '';
  const baselineCheckIndex = verify.indexOf('check:baseline');
  const bootstrapCheckIndex = verify.indexOf('check:bootstrap');
  if (baselineCheckIndex === -1 || bootstrapCheckIndex <= baselineCheckIndex) issues.push('root verify must run check:baseline before check:bootstrap');
  if (serverScripts['system:bootstrap'] !== 'tsx scripts/system/bootstrap-system.ts') issues.push('server bootstrap command is missing or changed');
  if (serverScripts['super-admin:recover'] !== 'tsx scripts/system/recover-super-admin.ts') issues.push('server recovery command is missing or changed');
  if (serverScripts['check:bootstrap'] !== 'tsx scripts/ci/check-bootstrap-contract.ts') issues.push('server bootstrap checker command is missing or changed');
  if (!/model\s+SystemInitialization\s+\{/.test(schema)) issues.push('SystemInitialization model is missing');
  if (!/ALLOW_SUPER_ADMIN_RECOVERY=false/.test(envExample)) issues.push('recovery gate example must default to false');
  if (!/auth\/password\/forced-change/.test(router)) issues.push('forced password change route is missing');
  if (/router\.(?:get|post|put|patch|delete)\s*\(\s*(['"`])[^'"`\r\n]*(?:bootstrap|recover)[^'"`\r\n]*\1/i.test(router)) issues.push('HTTP bootstrap or recovery route exists');
  if (/SystemBootstrapService|SuperAdminRecoveryService|system:bootstrap|super-admin:recover/.test(startup)) issues.push('startup invokes system commands');
  if (/--password|--temporary-password|(?:PASSWORD|PASSWD|PWD)_?=|process\.env(?:\.(?:PASSWORD|PASSWD|PWD)_?\b|\[['"](?:PASSWORD|PASSWD|PWD)_?['"]\])/i.test(cli)) issues.push('CLI accepts a password argument or environment variable');
  if (/admin\s*[/:]\s*123456/i.test(cli)) issues.push('CLI contains default credentials');
  return issues;
}

if (require.main === module) {
  const projectRoot = path.resolve(__dirname, '../../../..');
  const issues = checkBootstrapContract(projectRoot);
  if (issues.length > 0) {
    process.stderr.write(`${issues.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Bootstrap contract is valid.\n');
  }
}
