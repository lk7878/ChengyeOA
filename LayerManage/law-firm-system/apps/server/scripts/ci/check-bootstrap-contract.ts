import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

interface PackageManifest {
  scripts?: Record<string, unknown>;
}

const ROOT_VERIFY = 'npm run lint && npm run typecheck && npm run test && npm --prefix apps/server run check:baseline && npm run check:bootstrap && npm run build && npm run security:policy:validate';
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

interface RouterRegistration {
  method: string;
  routePath?: string;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node)) return unwrapExpression(node.expression);
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return unwrapExpression(node.expression);
  return node;
}

function routerPaths(source: string): RouterRegistration[] {
  const paths: RouterRegistration[] = [];
  const parsed = sourceFile('router.ts', source);
  const constants = new Map<string, ts.Expression>();
  const collectConstants = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isVariableDeclarationList(node.parent)
      && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectConstants);
  };
  collectConstants(parsed);

  const resolveString = (node: ts.Expression | undefined, resolving = new Set<string>()): string | undefined => {
    if (!node) return undefined;
    const expression = unwrapExpression(node);
    const literal = stringValue(expression);
    if (literal !== undefined) return literal;
    if (ts.isIdentifier(expression)) {
      if (resolving.has(expression.text)) return undefined;
      const initializer = constants.get(expression.text);
      if (!initializer) return undefined;
      const next = new Set(resolving).add(expression.text);
      return resolveString(initializer, next);
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolveString(expression.left, resolving);
      const right = resolveString(expression.right, resolving);
      return left !== undefined && right !== undefined ? left + right : undefined;
    }
    return undefined;
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const method = routerMethod(node.expression);
      if (method && ROUTER_METHODS.has(method)) {
        paths.push({ method, routePath: resolveString(node.arguments[0]) });
      }
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

function isProcessArgv(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'process'
    && node.name.text === 'argv';
}

function propertyName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined {
  return ts.isPropertyAccessExpression(node) ? node.name.text : stringValue(node.argumentExpression);
}

function sourcePropertyName(node: ts.Node, aliases: ReadonlySet<string>): string | undefined {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return undefined;
  const receiver = unwrapExpression(node.expression);
  if ((ts.isExpression(receiver) && isProcessEnv(receiver))
    || (ts.isIdentifier(receiver) && aliases.has(receiver.text))) {
    return propertyName(node);
  }
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

function expressionUsesSource(
  node: ts.Node,
  aliases: ReadonlySet<string>,
  directSource: (candidate: ts.Node) => boolean,
): boolean {
  let found = false;
  const visit = (candidate: ts.Node) => {
    if (found) return;
    if (directSource(candidate) || (ts.isIdentifier(candidate) && aliases.has(candidate.text))) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function identifierBinding(name: ts.BindingName): string | undefined {
  return ts.isIdentifier(name) ? name.text : undefined;
}

function invocationLeafName(expression: ts.Expression): string {
  const target = unwrapExpression(expression);
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  if (ts.isElementAccessExpression(target)) return stringValue(target.argumentExpression) ?? '';
  return '';
}

function namedProperty(node: ts.ObjectLiteralElementLike): string | undefined {
  if (!('name' in node) || !node.name) return undefined;
  return ts.isIdentifier(node.name) ? node.name.text : stringValue(node.name);
}

function passwordishOptionName(value: string): boolean {
  const optionName = value.trim().replace(/^--?/, '').split(/[\s<=[,|]/, 1)[0];
  const normalized = optionName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /(?:password|passwd|pwd)$/.test(normalized);
}

function parserOptionsHavePassword(node: ts.CallExpression, parserFunctions: ReadonlySet<string>): boolean {
  if (!parserFunctions.has(invocationLeafName(node.expression))) return false;
  return node.arguments.some(argument => {
    if (!ts.isObjectLiteralExpression(argument)) return false;
    const options = argument.properties.find(property => namedProperty(property) === 'options');
    if (!options || !ts.isPropertyAssignment(options) || !ts.isObjectLiteralExpression(options.initializer)) {
      return false;
    }
    return options.initializer.properties.some(property => {
      const name = namedProperty(property);
      return name !== undefined && passwordishOptionName(name);
    });
  });
}

function isParserResult(node: ts.Node, parserFunctions: ReadonlySet<string>): boolean {
  if (ts.isCallExpression(node)) {
    const name = invocationLeafName(node.expression);
    return parserFunctions.has(name) || /^(?:option|requiredOption|options|opts|parse|parseSync|argv)$/i.test(name);
  }
  return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    && propertyName(node)?.toLowerCase() === 'argv';
}

function callConsumesArgumentFlag(node: ts.CallExpression, parserFunctions: ReadonlySet<string>): boolean {
  if (parserOptionsHavePassword(node, parserFunctions)) return true;
  const callName = invocationLeafName(node.expression);
  if (/^(?:option|requiredOption|options)$/i.test(callName)) {
    return node.arguments.some(argument => {
      const value = stringValue(argument);
      return value !== undefined && passwordishOptionName(value);
    });
  }
  const hasPasswordFlag = node.arguments.some(argument => {
    const value = stringValue(argument);
    if (value === undefined) return false;
    const longOptions = value.match(/--[a-z0-9-]+/gi) ?? [];
    return longOptions.some(option => PASSWORD_FLAG.test(option));
  });
  if (!hasPasswordFlag) return false;
  if (ts.isIdentifier(node.expression)) return /arg|option|parse/i.test(node.expression.text);
  if (ts.isPropertyAccessExpression(node.expression)) {
    return /arg|option|parse|includes/i.test(node.expression.name.text);
  }
  return false;
}

function cliSourceHasPasswordSource(filePath: string): boolean {
  const parsed = sourceFile(filePath, read(filePath));
  const envAliases = new Set<string>();
  const argvAliases = new Set<string>();
  const parserAliases = new Set<string>();
  const parserFunctions = new Set(['parseArgs']);

  const collectParserImports = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && ['node:util', 'util'].includes(node.moduleSpecifier.text)
      && node.importClause?.namedBindings
      && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const specifier of node.importClause.namedBindings.elements) {
        if ((specifier.propertyName?.text ?? specifier.name.text) === 'parseArgs') {
          parserFunctions.add(specifier.name.text);
        }
      }
    }
    ts.forEachChild(node, collectParserImports);
  };
  collectParserImports(parsed);

  let changed = true;
  while (changed) {
    changed = false;
    const collectAliases = (node: ts.Node) => {
      let name: string | undefined;
      let initializer: ts.Expression | undefined;
      if (ts.isVariableDeclaration(node)) {
        name = identifierBinding(node.name);
        initializer = node.initializer;
      } else if (ts.isParameter(node)) {
        name = identifierBinding(node.name);
        initializer = node.initializer;
      }
      if (name && initializer) {
        if (!envAliases.has(name) && expressionUsesSource(initializer, envAliases, isProcessEnv)) {
          envAliases.add(name);
          changed = true;
        }
        if (!argvAliases.has(name) && expressionUsesSource(initializer, argvAliases, isProcessArgv)) {
          argvAliases.add(name);
          changed = true;
        }
        if (!parserAliases.has(name)
          && expressionUsesSource(initializer, parserAliases, candidate => isParserResult(candidate, parserFunctions))) {
          parserAliases.add(name);
          changed = true;
        }
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(parsed);
  }

  let forbidden = false;
  const visit = (node: ts.Node) => {
    if (forbidden) return;
    const envName = sourcePropertyName(node, envAliases);
    if (envName && PASSWORD_ENV_NAME.test(envName)) forbidden = true;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node))
      && node.initializer
      && expressionUsesSource(node.initializer, envAliases, isProcessEnv)) {
      if (bindingSourceNames(node.name).some(name => PASSWORD_ENV_NAME.test(name))) forbidden = true;
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.initializer
      && bindingNames(node.name).some(name => PASSWORD_IDENTIFIER.test(name))
      && expressionUsesSource(node.initializer, argvAliases, isProcessArgv)) {
      forbidden = true;
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.initializer
      && bindingSourceNames(node.name).some(passwordishOptionName)
      && expressionUsesSource(
        node.initializer,
        parserAliases,
        candidate => isParserResult(candidate, parserFunctions),
      )) {
      forbidden = true;
    }
    if (ts.isElementAccessExpression(node)
      && ((ts.isIdentifier(node.expression) && argvAliases.has(node.expression.text))
        || isProcessArgv(node.expression))) {
      const value = stringValue(node.argumentExpression);
      if (value && PASSWORD_FLAG.test(value)) forbidden = true;
    }
    if (ts.isCallExpression(node) && callConsumesArgumentFlag(node, parserFunctions)) forbidden = true;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return forbidden;
}

function invokedName(expression: ts.Expression): string {
  const target = unwrapExpression(expression);
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) {
    return `${invokedName(target.expression)}.${target.name.text}`;
  }
  if (ts.isElementAccessExpression(target)) {
    return `${invokedName(target.expression)}.${stringValue(target.argumentExpression) ?? ''}`;
  }
  return '';
}

const INTERACTIVE_SCRIPTS = new Set(['system:bootstrap', 'super-admin:recover', 'super-admin:add-second']);
const OUTPUT_INVOCATIONS = new Set([
  'debug', 'dir', 'error', 'info', 'log', 'output', 'print', 'printf', 'table', 'trace', 'warn', 'write', 'writeline',
]);
const DISPATCH_INVOCATIONS = new Set(['dispatch', 'run']);
const PROCESS_INVOCATIONS = new Set([
  'command', 'exec', 'execfile', 'execfilesync', 'execsync', 'spawn', 'spawnsync', 'system',
]);

function literalStrings(node: ts.Node): string[] {
  const direct = stringValue(node);
  if (direct !== undefined) return [direct];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(literalStrings);
  return [];
}

function commandLiteralInvokesInteractive(value: string): boolean {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return INTERACTIVE_SCRIPTS.has(tokens[0].toLowerCase());
  const npmIndex = tokens.findIndex(token => ['npm', 'npm.cmd'].includes(token.toLowerCase()));
  if (npmIndex === -1) return false;
  const runIndex = tokens.findIndex(
    (token, index) => index > npmIndex && ['run', 'run-script'].includes(token.toLowerCase()),
  );
  return runIndex !== -1
    && tokens.slice(runIndex + 1).some(token => INTERACTIVE_SCRIPTS.has(token.toLowerCase()));
}

function invocationHasInteractiveLiteral(node: ts.CallExpression | ts.NewExpression): boolean {
  const leafName = invocationLeafName(node.expression).toLowerCase();
  if (OUTPUT_INVOCATIONS.has(leafName)) return false;
  const argumentsList: readonly ts.Expression[] = node.arguments ?? [];
  const literals = argumentsList.flatMap(literalStrings);
  if (DISPATCH_INVOCATIONS.has(leafName)) {
    return literals.some(value => INTERACTIVE_SCRIPTS.has(value.trim().toLowerCase())
      || commandLiteralInvokesInteractive(value));
  }
  if (!PROCESS_INVOCATIONS.has(leafName)) return false;
  return literals.some(commandLiteralInvokesInteractive)
    || commandLiteralInvokesInteractive(literals.join(' '));
}

function startupInvokesSystemCommand(filePath: string): boolean {
  const parsed = sourceFile(filePath, read(filePath));
  const dangerousName = (name: string) => {
    const normalized = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return normalized.includes('systembootstrap')
      || normalized.includes('bootstrapsystem')
      || normalized.includes('superadminrecover')
      || normalized.includes('recoversuperadmin')
      || normalized.includes('secondsuperadmin')
      || normalized.includes('addsecondsuperadmin');
  };
  const dangerousAliases = new Set<string>();
  const collectImports = (node: ts.Node) => {
    if (ts.isImportSpecifier(node)) {
      const importedName = node.propertyName?.text ?? node.name.text;
      if (dangerousName(importedName)) dangerousAliases.add(node.name.text);
    }
    if (ts.isImportClause(node) && node.name && ts.isStringLiteral(node.parent.moduleSpecifier)
      && dangerousName(node.parent.moduleSpecifier.text)) {
      dangerousAliases.add(node.name.text);
    }
    ts.forEachChild(node, collectImports);
  };
  collectImports(parsed);

  let changed = true;
  while (changed) {
    changed = false;
    const collectAliases = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const sourceName = invokedName(node.initializer);
        if (!dangerousAliases.has(node.name.text)
          && (dangerousName(sourceName) || sourceName.split('.').some(name => dangerousAliases.has(name)))) {
          dangerousAliases.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(parsed);
  }

  const isDangerousInvocation = (name: string) => dangerousName(name)
    || name.split('.').some(part => dangerousAliases.has(part));
  let forbidden = false;
  const visit = (node: ts.Node) => {
    if (forbidden) return;
    if (ts.isNewExpression(node)
      && (isDangerousInvocation(invokedName(node.expression)) || invocationHasInteractiveLiteral(node))) {
      forbidden = true;
    }
    if (ts.isCallExpression(node)
      && (isDangerousInvocation(invokedName(node.expression)) || invocationHasInteractiveLiteral(node))) {
      forbidden = true;
    }
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

const REQUIRED_ROLE_CODES = ['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN', 'HR', 'SEAL_ADMIN', 'FINANCE', 'PARTNER', 'MANAGER'];
const SYSTEM_ROLE_CODES = ['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN'];
const BUSINESS_ROLE_CODES = ['HR', 'SEAL_ADMIN', 'FINANCE', 'PARTNER', 'MANAGER'];
const APPROVAL_REVIEWER_PERMISSION_CODES = ['approval.read', 'approval.process'];

interface BootstrapRoleLiteral {
  code?: string;
  type?: string;
  status?: string;
}

function bootstrapRoleLiterals(source: string): BootstrapRoleLiteral[] {
  const parsed = sourceFile('system-bootstrap-service.ts', source);
  const roles: BootstrapRoleLiteral[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const fields = new Map<string, string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = ts.isIdentifier(property.name) ? property.name.text : stringValue(property.name);
        const value = stringValue(property.initializer);
        if (name === undefined || value === undefined) continue;
        fields.set(name, value);
      }
      if (fields.has('code') && (fields.has('type') || fields.has('status'))) {
        roles.push({ code: fields.get('code'), type: fields.get('type'), status: fields.get('status') });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return roles;
}

function checkBootstrapRoles(source: string): string[] {
  const issues: string[] = [];
  const roles = bootstrapRoleLiterals(source);
  const byCode = new Map(
    roles.filter(role => role.code !== undefined).map(role => [role.code as string, role]),
  );

  for (const code of REQUIRED_ROLE_CODES) {
    if (!byCode.has(code)) issues.push(`bootstrap must provision role ${code}`);
  }
  for (const code of BUSINESS_ROLE_CODES) {
    const role = byCode.get(code);
    if (role && role.type !== 'BUSINESS') issues.push(`bootstrap role ${code} must have type BUSINESS`);
    if (role && role.status !== 'ENABLED') issues.push(`bootstrap role ${code} must have status ENABLED`);
  }
  for (const code of SYSTEM_ROLE_CODES) {
    const role = byCode.get(code);
    if (role && role.type !== 'SYSTEM') issues.push(`bootstrap role ${code} must have type SYSTEM`);
  }
  return issues;
}

function checkApprovalReviewerGrants(source: string): string[] {
  const issues: string[] = [];
  const stripped = withoutPrismaComments(source);
  for (const code of APPROVAL_REVIEWER_PERMISSION_CODES) {
    if (!stripped.includes(`'${code}'`) && !stripped.includes(`"${code}"`)) {
      issues.push(`bootstrap must grant approval reviewer permission ${code}`);
    }
  }
  return issues;
}

export function checkBootstrapContract(projectRoot: string): string[] {
  const issues: string[] = [];
  const serverRoot = path.join(projectRoot, 'apps', 'server');
  const rootScripts = manifest(path.join(projectRoot, 'package.json'), 'root', issues).scripts ?? {};
  const serverScripts = manifest(path.join(serverRoot, 'package.json'), 'server', issues).scripts ?? {};

  const rootBootstrap = script(rootScripts, 'root', 'system:bootstrap', issues);
  const rootRecovery = script(rootScripts, 'root', 'super-admin:recover', issues);
  const rootSecondSeat = script(rootScripts, 'root', 'super-admin:add-second', issues);
  const rootChecker = script(rootScripts, 'root', 'check:bootstrap', issues);
  const rootVerify = script(rootScripts, 'root', 'verify', issues);
  const serverBootstrap = script(serverScripts, 'server', 'system:bootstrap', issues);
  const serverRecovery = script(serverScripts, 'server', 'super-admin:recover', issues);
  const serverSecondSeat = script(serverScripts, 'server', 'super-admin:add-second', issues);
  const serverChecker = script(serverScripts, 'server', 'check:bootstrap', issues);

  if (rootBootstrap !== 'npm --prefix apps/server run system:bootstrap') issues.push('root bootstrap command is missing or changed');
  if (rootRecovery !== 'npm --prefix apps/server run super-admin:recover') issues.push('root recovery command is missing or changed');
  if (rootSecondSeat !== 'npm --prefix apps/server run super-admin:add-second') issues.push('root second-super-admin command is missing or changed');
  if (rootChecker !== 'npm --prefix apps/server run check:bootstrap') issues.push('root bootstrap checker command is missing or changed');
  if (!sameCommandTokens(rootVerify, ROOT_VERIFY)) issues.push('root verify must run check:baseline before check:bootstrap');
  if (serverBootstrap !== 'tsx scripts/system/bootstrap-system.ts') issues.push('server bootstrap command is missing or changed');
  if (serverRecovery !== 'tsx scripts/system/recover-super-admin.ts') issues.push('server recovery command is missing or changed');
  if (serverSecondSeat !== 'tsx scripts/system/add-second-super-admin.ts') issues.push('server second-super-admin command is missing or changed');
  if (serverChecker !== 'tsx scripts/ci/check-bootstrap-contract.ts') issues.push('server bootstrap checker command is missing or changed');
  if (!fs.existsSync(path.join(serverRoot, 'scripts', 'system', 'add-second-super-admin.ts'))) {
    issues.push('second-super-admin CLI source is missing');
  }

  const schema = withoutPrismaComments(read(path.join(serverRoot, 'prisma', 'schema.prisma')));
  if (!/\bmodel\s+SystemInitialization\s+\{/.test(schema)) issues.push('SystemInitialization model is missing');

  if (!recoveryGateDefaultsFalse(read(path.join(serverRoot, '.env.example')))) {
    issues.push('recovery gate example must default to false');
  }

  const bootstrapServiceSource = read(
    path.join(serverRoot, 'app', 'application', 'system', 'system-bootstrap-service.ts'),
  );
  issues.push(...checkBootstrapRoles(bootstrapServiceSource), ...checkApprovalReviewerGrants(bootstrapServiceSource));

  const routes = routerPaths(read(path.join(serverRoot, 'app', 'router.ts')));
  if (!routes.some(route => route.routePath === '/api/v1/auth/password/forced-change')) {
    issues.push('forced password change route is missing');
  }
  if (routes.some(route => route.routePath === undefined
    || /(?:^|\/)(?:bootstrap|recover)(?:\/|$)/i.test(route.routePath))) {
    issues.push('HTTP bootstrap or recovery route exists');
  }

  const startupFiles = [
    path.join(serverRoot, 'app.ts'),
    path.join(serverRoot, 'server-entry.js'),
    path.join(serverRoot, 'config', 'config.default.ts'),
  ];
  if (startupFiles.some(startupInvokesSystemCommand)) {
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
