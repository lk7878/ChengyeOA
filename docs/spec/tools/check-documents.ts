/** Apply the project's existing secret-leakage rules to this documentation change. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanPersistedDocumentationContent } from '../../../LayerManage/law-firm-system/apps/server/scripts/ci/check-persisted-documentation-leakage';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const paths = new Set<string>();
for (const args of [
  ['diff', '--name-only', '-z', 'HEAD'],
  ['ls-files', '--others', '--exclude-standard', '-z'],
]) {
  for (const p of execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0'))
    if (p.endsWith('.md')) paths.add(p);
}
const findings: unknown[] = [];
for (const p of paths) {
  let content: string;
  try { content = readFileSync(path.join(root, p), 'utf8'); }
  catch (error) { if ((error as { code?: string }).code === 'ENOENT') continue; throw error; }
  for (const f of scanPersistedDocumentationContent(content)) findings.push({ file: p, ...f });
}
console.log(JSON.stringify({ markdownFiles: paths.size, findings }, null, 2));
if (findings.length) process.exitCode = 1;
