import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

interface PackageManifest {
  scripts?: Record<string, unknown>;
}

const ROOT_VERIFY = 'npm run lint && npm run typecheck && npm run test && npm --prefix apps/server run check:baseline && npm run check:bootstrap && npm run build';
const ROUTER_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);
const PASSWORD_ENV_NAME = /^(?:PASSWORD|PASSWD|PWD|.+_(?:PASSWORD|PASSWD|PWD))$/i;
const PASSWORD_FLAG = /^--(?:[a-z0-9]+-)*(?:password|passwd|pwd)$/i;
const PASSWORD_IDENTIFIER = /^(?:password|passwd|pwd|.+_(?:password|passwd|pwd)|.+(?:Password|Passwd|Pwd))$/;

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

function script(
  scripts: Record<string, unknown>,
  scope: 'root' | 'server',
  name: string,
  issues: string[],
): string | undefined {
  const value = scripts[name];
  if (value !== undefined && typeof value !== 'string') {
    issues.push(`${scope} ${name} script must be a string`);
    return undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function sameCommandTokens(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const tokens = (value: string) => value.trim().split(/\s+/);
  const actualTokens = tokens(actual);
  const expectedTokens = tokens(expected);
  return actualTokens.length === expectedTokens.length
    && actualTokens.every((token, index) => token === expectedTokens[index]);
}

function withoutPrismaComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function recoveryGateDefaultsFalse(source: string): boolean {
  const assignments = source.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => line.match(/^ALLOW_SUPER_ADMIN_RECOVERY\s*=\s*([^\s#]+)(?:\s+#.*)?$/))
    .filter((match): match is RegExpMatchArray => match !== null);
  return assignments.length === 1 && assignments[0][1] === 'false';
}

function sourceFile(fileName: string, source: string): ts.SourceFile {
  const scriptKind = fileName.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
}

function stringValue(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function routerMethod(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'router') {
    return expression.name.text;
  }
  if (ts.isElementAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'router') {
    return stringValue(expression.argumentExpression);
  }
  return undefined;
}

function routerPaths(source: string): Array<{ method: string; routePath: string }> {
  const paths: Array<{ method: string; routePath: string }> = [];
  const parsed = sourceFile('router.ts', source);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const method = routerMethod(node.expression);
      const routePath = stringValue(node.arguments[0]);
      if (method && routePath && ROUTER_METHODS.has(method)) paths.push({ method, routePath });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return paths;
}

function typescriptFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(candidate);
      return entry.isFile() && entry.name.endsWith('.ts') ? [candidate] : [];
    })
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function isProcessEnv(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'process'
    && node.name.text === 'env';
}

function environmentName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) return node.name.text;
  if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) return stringValue(node.argumentExpression);
  return undefined;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
}

function bindingSourceNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => {
    if (ts.isOmittedExpression(element)) return [];
    const propertyName = element.propertyName
      && (ts.isIdentifier(element.propertyName) ? element.propertyName.text : stringValue(element.propertyName));
    return [...(propertyName ? [propertyName] : []), ...bindingSourceNames(element.name)];
  });
}

function isArgvReceiver(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return /^(?:argv|args?)$/i.test(node.text);
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'process'
    && node.name.text === 'argv';
}

function containsArgvSource(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node) => {
    if (found) return;
    if (ts.isExpression(candidate) && isArgvReceiver(candidate)) found = true;
    if (ts.isCallExpression(candidate)) {
      const expression = candidate.expression;
      const name = ts.isIdentifier(expression)
        ? expression.text
        : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
      if (/^(?:parseArgs?|argument|option)$/i.test(name)) found = true;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function callConsumesArgumentFlag(node: ts.CallExpression): boolean {
  const hasPasswordFlag = node.arguments.some(argument => {
    const value = stringValue(argument);
    return value !== undefined && PASSWORD_FLAG.test(value);
  });
  if (!hasPasswordFlag) return false;
  if (ts.isIdentifier(node.expression)) return /arg|option|parse/i.test(node.expression.text);
  if (ts.isPropertyAccessExpression(node.expression)) {
    return isArgvReceiver(node.expression.expression)
      || /arg|option|parse|includes/i.test(node.expression.name.text);
  }
  return false;
}

function cliSourceHasPasswordSource(filePath: string): boolean {
  const parsed = sourceFile(filePath, read(filePath));
  let forbidden = false;
  const visit = (node: ts.Node) => {
    if (forbidden) return;
    const envName = environmentName(node);
    if (envName && PASSWORD_ENV_NAME.test(envName)) forbidden = true;
    if (ts.isVariableDeclaration(node) && node.initializer && isProcessEnv(node.initializer)) {
      if (bindingSourceNames(node.name).some(name => PASSWORD_ENV_NAME.test(name))) forbidden = true;
    }
    if (ts.isVariableDeclaration(node) && node.initializer
      && bindingNames(node.name).some(name => PASSWORD_IDENTIFIER.test(name))
      && containsArgvSource(node.initializer)) {
      forbidden = true;
    }
    if (ts.isElementAccessExpression(node) && isArgvReceiver(node.expression)) {
      const value = stringValue(node.argumentExpression);
      if (value && PASSWORD_FLAG.test(value)) forbidden = true;
    }
    if (ts.isCallExpression(node) && callConsumesArgumentFlag(node)) forbidden = true;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return forbidden;
}

function cliSourceHasDefaultCredential(filePath: string): boolean {
  const parsed = sourceFile(filePath, read(filePath));
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && /admin\s*[/:]\s*123456/i.test(node.text)) {
      found = true;
      return;
    }
    if (ts.isVariableDeclaration(node) && stringValue(node.initializer) !== undefined
      && bindingNames(node.name).some(name => PASSWORD_IDENTIFIER.test(name))) {
      found = true;
      return;
    }
    if (ts.isPropertyAssignment(node) && stringValue(node.initializer) !== undefined) {
      const name = ts.isIdentifier(node.name) ? node.name.text : stringValue(node.name);
      if (name && PASSWORD_IDENTIFIER.test(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

export function checkBootstrapContract(projectRoot: string): string[] {
  const issues: string[] = [];
  const serverRoot = path.join(projectRoot, 'apps', 'server');
  const rootScripts = manifest(path.join(projectRoot, 'package.json'), 'root', issues).scripts ?? {};
  const serverScripts = manifest(path.join(serverRoot, 'package.json'), 'server', issues).scripts ?? {};

  const rootBootstrap = script(rootScripts, 'root', 'system:bootstrap', issues);
  const rootRecovery = script(rootScripts, 'root', 'super-admin:recover', issues);
  const rootChecker = script(rootScripts, 'root', 'check:bootstrap', issues);
  const rootVerify = script(rootScripts, 'root', 'verify', issues);
  const serverBootstrap = script(serverScripts, 'server', 'system:bootstrap', issues);
  const serverRecovery = script(serverScripts, 'server', 'super-admin:recover', issues);
  const serverChecker = script(serverScripts, 'server', 'check:bootstrap', issues);

  if (rootBootstrap !== 'npm --prefix apps/server run system:bootstrap') issues.push('root bootstrap command is missing or changed');
  if (rootRecovery !== 'npm --prefix apps/server run super-admin:recover') issues.push('root recovery command is missing or changed');
  if (rootChecker !== 'npm --prefix apps/server run check:bootstrap') issues.push('root bootstrap checker command is missing or changed');
  if (!sameCommandTokens(rootVerify, ROOT_VERIFY)) issues.push('root verify must run check:baseline before check:bootstrap');
  if (serverBootstrap !== 'tsx scripts/system/bootstrap-system.ts') issues.push('server bootstrap command is missing or changed');
  if (serverRecovery !== 'tsx scripts/system/recover-super-admin.ts') issues.push('server recovery command is missing or changed');
  if (serverChecker !== 'tsx scripts/ci/check-bootstrap-contract.ts') issues.push('server bootstrap checker command is missing or changed');

  const schema = withoutPrismaComments(read(path.join(serverRoot, 'prisma', 'schema.prisma')));
  if (!/\bmodel\s+SystemInitialization\s+\{/.test(schema)) issues.push('SystemInitialization model is missing');

  if (!recoveryGateDefaultsFalse(read(path.join(serverRoot, '.env.example')))) {
    issues.push('recovery gate example must default to false');
  }

  const routes = routerPaths(read(path.join(serverRoot, 'app', 'router.ts')));
  if (!routes.some(route => route.routePath.includes('/auth/password/forced-change'))) {
    issues.push('forced password change route is missing');
  }
  if (routes.some(route => /(?:bootstrap|recover)/i.test(route.routePath))) {
    issues.push('HTTP bootstrap or recovery route exists');
  }

  const startupFiles = [
    path.join(serverRoot, 'app.ts'),
    path.join(serverRoot, 'server-entry.js'),
    path.join(serverRoot, 'config', 'config.default.ts'),
  ];
  const startup = startupFiles.map(filePath => read(filePath)).join('\n');
  if (/SystemBootstrapService|SuperAdminRecoveryService|system:bootstrap|super-admin:recover/.test(startup)) {
    issues.push('startup invokes system commands');
  }

  const cliFiles = typescriptFiles(path.join(serverRoot, 'scripts', 'system'));
  if (cliFiles.some(cliSourceHasPasswordSource)) {
    issues.push('CLI accepts a password argument or environment variable');
  }
  if (cliFiles.some(cliSourceHasDefaultCredential)) issues.push('CLI contains default credentials');
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
