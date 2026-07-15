import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkBootstrapContract } from '../../scripts/ci/check-bootstrap-contract';

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const projectRoot = path.join(repositoryRoot, 'LayerManage', 'law-firm-system');

const validRootScripts = {
  'db:deploy': 'npm --prefix apps/server run db:deploy',
  'system:bootstrap': 'npm --prefix apps/server run system:bootstrap',
  'super-admin:recover': 'npm --prefix apps/server run super-admin:recover',
  'check:bootstrap': 'npm --prefix apps/server run check:bootstrap',
  verify: 'npm run lint && npm --prefix apps/server run check:baseline && npm run check:bootstrap && npm run build',
};

const validServerScripts = {
  'system:bootstrap': 'tsx scripts/system/bootstrap-system.ts',
  'super-admin:recover': 'tsx scripts/system/recover-super-admin.ts',
  'check:bootstrap': 'tsx scripts/ci/check-bootstrap-contract.ts',
};

interface ProjectFixture {
  projectRoot: string;
  serverRoot: string;
  write(relativePath: string, contents: string): void;
}

function createProjectFixture(): ProjectFixture {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-contract-'));
  const serverRoot = path.join(fixtureRoot, 'apps', 'server');

  const write = (relativePath: string, contents: string) => {
    const filePath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  };

  write('package.json', JSON.stringify({ scripts: validRootScripts }));
  write('apps/server/package.json', JSON.stringify({ scripts: validServerScripts }));
  write('apps/server/prisma/schema.prisma', 'model SystemInitialization {\n  id String @id\n}\n');
  write('apps/server/app/router.ts', "router.post('/auth/password/forced-change', controller.auth.forcedChange);\n");
  write('apps/server/.env.example', 'ALLOW_SUPER_ADMIN_RECOVERY=false\n');
  write('apps/server/app.ts', 'export default class AppBootHook {}\n');
  write('apps/server/server-entry.js', "require('./dist/app');\n");
  write('apps/server/config/config.default.ts', 'export default {};\n');
  write('apps/server/scripts/system/bootstrap-system.ts', 'runInteractiveBootstrap();\n');
  write('apps/server/scripts/system/recover-super-admin.ts', 'runInteractiveRecovery();\n');
  write('apps/server/scripts/system/system-cli.ts', 'export function hiddenPrompt() {}\n');

  return { projectRoot: fixtureRoot, serverRoot, write };
}

function withFixture(run: (fixture: ProjectFixture) => void): void {
  const fixture = createProjectFixture();
  try {
    run(fixture);
  } finally {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  }
}

function assertOnlyIssue(mutate: (fixture: ProjectFixture) => void, expectedIssue: string): void {
  withFixture(fixture => {
    mutate(fixture);
    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), [expectedIssue]);
  });
}

test('the repository satisfies the bootstrap contract', () => {
  assert.deepEqual(checkBootstrapContract(projectRoot), []);
});

test('a complete fixture satisfies the bootstrap contract', () => {
  withFixture(fixture => {
    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), []);
  });
});

test('requires the exact root bootstrap command', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: { ...validRootScripts, 'system:bootstrap': 'node bootstrap.js' },
  })), 'root bootstrap command is missing or changed');
});

test('requires the exact root recovery command', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: { ...validRootScripts, 'super-admin:recover': 'node recover.js' },
  })), 'root recovery command is missing or changed');
});

test('requires the exact root bootstrap checker command', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: { ...validRootScripts, 'check:bootstrap': 'tsx another-checker.ts' },
  })), 'root bootstrap checker command is missing or changed');
});

test('requires root verify to run the baseline checker before the bootstrap checker', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: {
      ...validRootScripts,
      verify: 'npm run lint && npm run check:bootstrap && npm --prefix apps/server run check:baseline && npm run build',
    },
  })), 'root verify must run check:baseline before check:bootstrap');
});

test('requires the exact server bootstrap command', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/package.json', JSON.stringify({
    scripts: { ...validServerScripts, 'system:bootstrap': 'tsx scripts/system/another-bootstrap.ts' },
  })), 'server bootstrap command is missing or changed');
});

test('requires the exact server recovery command', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/package.json', JSON.stringify({
    scripts: { ...validServerScripts, 'super-admin:recover': 'tsx scripts/system/another-recovery.ts' },
  })), 'server recovery command is missing or changed');
});

test('requires the exact server bootstrap checker command', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/package.json', JSON.stringify({
    scripts: { ...validServerScripts, 'check:bootstrap': 'tsx scripts/ci/another-checker.ts' },
  })), 'server bootstrap checker command is missing or changed');
});

test('requires the SystemInitialization model', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/prisma/schema.prisma', ''), 'SystemInitialization model is missing');
});

test('requires the recovery example gate to default to false', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/.env.example', 'ALLOW_SUPER_ADMIN_RECOVERY=true\n'), 'recovery gate example must default to false');
});

test('requires the forced password change route', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', ''), 'forced password change route is missing');
});

test('rejects an HTTP bootstrap route', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
    "router.post('/auth/password/forced-change', controller.auth.forcedChange);",
    "router.post('/system/bootstrap', controller.system.bootstrap);",
  ].join('\n')), 'HTTP bootstrap or recovery route exists');
});

test('rejects an HTTP recovery route', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
    "router.post('/auth/password/forced-change', controller.auth.forcedChange);",
    "router.patch('/admin/recover', controller.admin.recover);",
  ].join('\n')), 'HTTP bootstrap or recovery route exists');
});

test('rejects a multiline HTTP bootstrap route', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
    "router.post('/auth/password/forced-change', controller.auth.forcedChange);",
    'router.post(',
    "  '/system/bootstrap',",
    '  controller.system.bootstrap,',
    ');',
  ].join('\n')), 'HTTP bootstrap or recovery route exists');
});

test('rejects bootstrap service invocation from startup', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app.ts', 'new SystemBootstrapService().execute();\n'), 'startup invokes system commands');
});

test('rejects recovery command invocation from startup configuration', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/config/config.default.ts', "run('super-admin:recover');\n"), 'startup invokes system commands');
});

test('rejects password command-line arguments in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/bootstrap-system.ts', 'const password = argv[\'--password\'];\n'), 'CLI accepts a password argument or environment variable');
});

test('rejects temporary password command-line arguments in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/recover-super-admin.ts', 'parseOption(\'--temporary-password\');\n'), 'CLI accepts a password argument or environment variable');
});

test('rejects password environment-variable assignments in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/system-cli.ts', "const source = 'PASSWORD=';\n"), 'CLI accepts a password argument or environment variable');
});

test('rejects password environment-variable reads in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/system-cli.ts', 'const password = process.env.PASSWORD;\n'), 'CLI accepts a password argument or environment variable');
});

test('rejects default administrator credentials in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/bootstrap-system.ts', "const credentials = 'admin / 123456';\n"), 'CLI contains default credentials');
});

test('missing manifests fail safely with deterministic issues', () => {
  withFixture(fixture => {
    fs.rmSync(path.join(fixture.projectRoot, 'package.json'));
    fs.rmSync(path.join(fixture.serverRoot, 'package.json'));

    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), [
      'root package manifest is missing',
      'server package manifest is missing',
      'root bootstrap command is missing or changed',
      'root recovery command is missing or changed',
      'root bootstrap checker command is missing or changed',
      'root verify must run check:baseline before check:bootstrap',
      'server bootstrap command is missing or changed',
      'server recovery command is missing or changed',
      'server bootstrap checker command is missing or changed',
    ]);
  });
});

test('malformed manifests fail safely with deterministic useful issues', () => {
  withFixture(fixture => {
    fixture.write('package.json', '{not-json');
    fixture.write('apps/server/package.json', '[]');

    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), [
      'root package manifest is invalid JSON',
      'server package manifest must contain a JSON object',
      'root bootstrap command is missing or changed',
      'root recovery command is missing or changed',
      'root bootstrap checker command is missing or changed',
      'root verify must run check:baseline before check:bootstrap',
      'server bootstrap command is missing or changed',
      'server recovery command is missing or changed',
      'server bootstrap checker command is missing or changed',
    ]);
  });
});
