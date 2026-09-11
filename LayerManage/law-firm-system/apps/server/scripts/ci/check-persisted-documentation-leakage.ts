import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export type DocumentationLeakageRule =
  | 'DATABASE_URL_USERINFO'
  | 'SENSITIVE_ENV_ASSIGNMENT'
  | 'KNOWN_FIXED_TEST_MATERIAL';

export interface DocumentationLeakageFinding {
  readonly line: number;
  readonly rule: DocumentationLeakageRule;
}

export interface PersistedDocumentationFile {
  readonly relativePath: string;
  readonly content: string;
}

const KNOWN_FIXED_TEST_FINGERPRINTS = new Set([
  '861009ec4d599fab1f40abc76e6f89880cff5833c79c548c99f9045f191cd90b',
  'dcd5a0e9c5c373ded86be232151c7ac0ba8f4fe68652cbc37d88e0b10df115cf',
  'edc46a4d900102ce0a6a0e19510712ec955726ddfd58756771c3012ffa4c5ce2',
  '2cf5e6ec387461b4bf954f587ad4d957753fcbc48bf892b5e49996b90cf3b476',
]);

const URL_USERINFO_PATTERN = /postgres(?:ql)?:\/\/[^/\s:@]+:[^@\s/]+@/i;
const SENSITIVE_ASSIGNMENT_PATTERN = /(?:\$env:)?(?:JWT_SECRET|APP_KEYS|MFA_ENCRYPTION_KEY(?:_V1)?)\s*=\s*(['"]?)([^'"\r\n]+)\1/i;
const FINGERPRINT_CANDIDATE_PATTERN = /[A-Za-z0-9_.,=+!/-]{24,}/g;

export function scanPersistedDocumentationContent(content: string): DocumentationLeakageFinding[] {
  const findings: DocumentationLeakageFinding[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (URL_USERINFO_PATTERN.test(line)) {
      findings.push({ line: index + 1, rule: 'DATABASE_URL_USERINFO' });
    }
    const assignment = SENSITIVE_ASSIGNMENT_PATTERN.exec(line);
    if (assignment && !isExplicitPlaceholder(assignment[2])) {
      findings.push({ line: index + 1, rule: 'SENSITIVE_ENV_ASSIGNMENT' });
    }
    for (const candidate of line.match(FINGERPRINT_CANDIDATE_PATTERN) ?? []) {
      if (KNOWN_FIXED_TEST_FINGERPRINTS.has(fingerprint(candidate))) {
        findings.push({ line: index + 1, rule: 'KNOWN_FIXED_TEST_MATERIAL' });
      }
    }
  }
  return findings;
}

export function findDocumentationRoot(start = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, '.superpowers', 'sdd'))
      && existsSync(path.join(current, 'docs', 'superpowers'))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Persisted documentation root was not found');
    current = parent;
  }
}

export function findPersistedDocumentationFiles(root: string): PersistedDocumentationFile[] {
  const files = [
    ...findMarkdownFiles(path.join(root, '.superpowers', 'sdd')).filter(file => file.endsWith('-report.md')),
    ...findMarkdownFiles(path.join(root, 'docs', 'superpowers', 'handoffs')),
    ...findMarkdownFiles(path.join(root, 'docs', 'superpowers', 'reports')),
  ].sort((left, right) => left.localeCompare(right));
  return files.map(file => ({
    relativePath: path.relative(root, file).replaceAll(path.sep, '/'),
    content: readFileSync(file, 'utf8'),
  }));
}

function findMarkdownFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(directory)) {
    const target = path.join(directory, entry);
    if (statSync(target).isDirectory()) result.push(...findMarkdownFiles(target));
    else if (entry.endsWith('.md')) result.push(target);
  }
  return result;
}

function isExplicitPlaceholder(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith('<') && normalized.endsWith('>');
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function main(): number {
  const root = findDocumentationRoot();
  const findings = findPersistedDocumentationFiles(root).flatMap(file => (
    scanPersistedDocumentationContent(file.content).map(finding => ({ ...finding, file: file.relativePath }))
  ));
  if (findings.length === 0) {
    process.stdout.write('Persisted documentation leakage scan passed.\n');
    return 0;
  }
  for (const finding of findings) {
    process.stderr.write(`${finding.file}:${finding.line}:${finding.rule}\n`);
  }
  return 1;
}

if (require.main === module) process.exitCode = main();
