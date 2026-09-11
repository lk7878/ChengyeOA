import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const roots = [resolve('dist'), resolve('../web/dist')];
const forbiddenFixtures: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  ...['change-token', 'mfa-token', 'access-token', 'csrf-token', 'one-time-grant'].map(label => ({
    label,
    pattern: new RegExp(`(?<![A-Za-z0-9_-])${label}(?![A-Za-z0-9_-])`),
  })),
  { label: 'AAAA-BBBB-CCCC-DDDD', pattern: /AAAA-BBBB-CCCC-DDDD/ },
  { label: 'EEEE-FFFF-GGGG-HHHH', pattern: /EEEE-FFFF-GGGG-HHHH/ },
  {
    label: '0123456789abcdef0123456789abcdef',
    pattern: /0123456789abcdef0123456789abcdef/,
  },
  ...[
    'event-private-governance-reason',
    'event-private-review-comment',
    'event-private-business-payload',
  ].map(label => ({
    label,
    pattern: new RegExp(`(?<![A-Za-z0-9_-])${label}(?![A-Za-z0-9_-])`),
  })),
  ...[
    'spec008-private-governance-reason',
    'spec008-private-review-comment',
    'spec008-private-business-payload',
    'spec008-private-availability-detail',
  ].map(label => ({
    label,
    pattern: new RegExp(
      `(?<![A-Za-z0-9_-])${label}(?=-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![A-Za-z0-9_-])|[^A-Za-z0-9_-]|$)`,
      'i',
    ),
  })),
];

export function findLeakedFixture(content: string): string | undefined {
  return forbiddenFixtures.find(fixture => fixture.pattern.test(content))?.label;
}

export function checkBuiltLeakage(outputRoots: readonly string[] = roots): void {
  for (const root of outputRoots) {
    if (!existsSync(root)) throw new Error(`SPEC-006 leakage scan requires built output: ${root}`);
    for (const file of files(root)) {
      if (!/\.(?:css|html|js|json|map|mjs|txt)$/i.test(file)) continue;
      if (/check-spec-006-built-leakage\.(?:js|map)$/i.test(file)) continue;
      const leaked = findLeakedFixture(readFileSync(file, 'utf8'));
      if (leaked) throw new Error(`SPEC-006 fixture leaked into built output: ${file} (${leaked})`);
    }
  }
}

if (require.main === module) {
  checkBuiltLeakage();
  process.stdout.write('SPEC-006 built-artifact leakage scan passed\n');
}

function files(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
